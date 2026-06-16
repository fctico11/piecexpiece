import type { APIRoute } from 'astro';
import { createHash } from 'crypto';
import Stripe from 'stripe';

export const prerender = false;

const CLASSES_PATH = 'src/data/classes.json';
const IMAGES_DIR   = 'public/images/classes';

function isAuthorized(request: Request): boolean {
  const password = import.meta.env.ADMIN_PASSWORD ?? '';
  const cookie   = request.headers.get('cookie') ?? '';
  const match    = cookie.match(/(?:^|;\s*)pxp_auth=([^;]+)/);
  const expected = createHash('sha256').update(password + ':pxp-editor').digest('hex');
  return !!match && match[1] === expected;
}

function slugify(text: string, date: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    + '-' + date.replace(/-/g, '');
}

async function githubGet(path: string, headers: Record<string, string>, branch: string) {
  const owner  = import.meta.env.GITHUB_OWNER;
  const repo   = import.meta.env.GITHUB_REPO;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    { headers }
  );
  if (!res.ok) return null;
  return res.json() as Promise<{ sha: string; content: string }>;
}

async function githubPut(
  path: string,
  headers: Record<string, string>,
  branch: string,
  message: string,
  content: string,       // base64
  sha?: string
) {
  const owner = import.meta.env.GITHUB_OWNER;
  const repo  = import.meta.env.GITHUB_REPO;
  const body: Record<string, string> = { message, content, branch };
  if (sha) body.sha = sha;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { method: 'PUT', headers, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`GitHub write failed: ${await res.text()}`);
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: {
    id?: string;
    title: string;
    description: string;
    location: string;
    date: string;
    time: string;
    duration: string;
    price: number;
    totalTickets: number;
    badge?: string;
    featured: boolean;
    externalUrl?: string | null;
    promotional?: boolean;
    imageBase64?: string;
    imageExt?: string;
    stripeProductId?: string;
    stripePriceId?: string;
  };

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const ghToken = import.meta.env.GITHUB_TOKEN;
  const branch  = import.meta.env.GITHUB_BRANCH ?? 'main';
  const ghHeaders = {
    Authorization: `Bearer ${ghToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  const isPromotional = !!body.promotional;
  const isExternal = !isPromotional && !!body.externalUrl;
  const skipStripe = isExternal || isPromotional;
  const stripeKey  = import.meta.env.STRIPE_SECRET_KEY;
  if (!skipStripe && !stripeKey) {
    return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY not set' }), { status: 500 });
  }
  const stripe = skipStripe ? null : new Stripe(stripeKey!, { apiVersion: '2025-02-24.acacia' });

  const isEdit   = !!body.id;
  const classId  = body.id || slugify(body.title, body.date);
  const imageExt = body.imageExt || 'jpg';
  const imagePath = `${IMAGES_DIR}/${classId}.${imageExt}`;
  const imageUrl  = `/images/classes/${classId}.${imageExt}`;

  try {
    // ── 1. Upload image to GitHub if provided ─────────────────────────────
    if (body.imageBase64) {
      const existing = await githubGet(imagePath, ghHeaders, branch);
      await githubPut(
        imagePath,
        ghHeaders,
        branch,
        `${isEdit ? 'Update' : 'Add'} class image: ${classId}`,
        body.imageBase64,
        existing?.sha
      );
    }

    // ── 2. Create or update Stripe Product (skip for external classes) ──────
    let stripeProductId = body.stripeProductId;
    let stripePriceId   = body.stripePriceId;

    if (!skipStripe && stripe) {
      const priceInCents = Math.round(body.price * 100);
      const metadata = {
        location:     body.location,
        date:         body.date,
        time:         body.time,
        duration:     body.duration,
        totalTickets: String(body.totalTickets),
        ticketsSold:  '0',
        featured:     body.featured ? 'true' : 'false',
        badge:        body.badge || '',
        classId,
      };

      if (isEdit && stripeProductId) {
        await stripe.products.update(stripeProductId, {
          name:        body.title,
          description: body.description,
          metadata,
        });
        const existingPrice = await stripe.prices.retrieve(stripePriceId!);
        if (existingPrice.unit_amount !== priceInCents) {
          await stripe.prices.update(stripePriceId!, { active: false });
          const newPrice = await stripe.prices.create({
            product:     stripeProductId,
            unit_amount: priceInCents,
            currency:    'usd',
          });
          await stripe.products.update(stripeProductId, { default_price: newPrice.id });
          stripePriceId = newPrice.id;
        }
      } else {
        const product = await stripe.products.create({
          name:        body.title,
          description: body.description,
          metadata,
        });
        stripeProductId = product.id;
        const price = await stripe.prices.create({
          product:     stripeProductId,
          unit_amount: priceInCents,
          currency:    'usd',
        });
        stripePriceId = price.id;
        await stripe.products.update(stripeProductId, { default_price: stripePriceId });
      }
    }

    // ── 3. Read + update classes.json ─────────────────────────────────────
    const file = await githubGet(CLASSES_PATH, ghHeaders, branch);
    let data: { classes: any[] } = { classes: [] };
    if (file?.content) {
      data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    }

    const classEntry = {
      id:             classId,
      title:          body.title,
      description:    body.description,
      location:       body.location,
      date:           body.date,
      time:           body.time,
      duration:       body.duration,
      price:          body.price || 0,
      totalTickets:   body.totalTickets || 0,
      ticketsSold:    0,
      badge:          body.badge || null,
      featured:       body.featured,
      externalUrl:    isPromotional ? null : (body.externalUrl || null),
      promotional:    isPromotional,
      image:          body.imageBase64 ? imageUrl : (data.classes.find(c => c.id === classId)?.image || imageUrl),
      stripeProductId: skipStripe ? null : stripeProductId,
      stripePriceId:   skipStripe ? null : stripePriceId,
    };

    if (isEdit) {
      const idx = data.classes.findIndex((c: any) => c.id === classId);
      if (idx >= 0) {
        // Preserve ticketsSold from existing entry
        classEntry.ticketsSold = data.classes[idx].ticketsSold || 0;
        data.classes[idx] = classEntry;
      } else {
        data.classes.push(classEntry);
      }
    } else {
      data.classes.push(classEntry);
    }

    // Sort by date ascending
    data.classes.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const newContent = Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64');
    await githubPut(
      CLASSES_PATH,
      ghHeaders,
      branch,
      `${isEdit ? 'Update' : 'Add'} class: ${body.title}`,
      newContent,
      file?.sha
    );

    return new Response(JSON.stringify({ ok: true, classId, stripeProductId, stripePriceId }), { status: 200 });
  } catch (err: any) {
    console.error('Class upsert error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
