import type { APIRoute } from 'astro';
import { createHash } from 'crypto';
import Stripe from 'stripe';

export const prerender = false;

const CLASSES_PATH = 'src/data/classes.json';

function isAuthorized(request: Request): boolean {
  const password = import.meta.env.ADMIN_PASSWORD ?? '';
  const cookie   = request.headers.get('cookie') ?? '';
  const match    = cookie.match(/(?:^|;\s*)pxp_auth=([^;]+)/);
  const expected = createHash('sha256').update(password + ':pxp-editor').digest('hex');
  return !!match && match[1] === expected;
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { classId } = await request.json() as { classId: string };
  if (!classId) return new Response(JSON.stringify({ error: 'Missing classId' }), { status: 400 });

  const ghToken  = import.meta.env.GITHUB_TOKEN;
  const branch   = import.meta.env.GITHUB_BRANCH ?? 'main';
  const owner    = import.meta.env.GITHUB_OWNER;
  const repo     = import.meta.env.GITHUB_REPO;
  const ghHeaders = {
    Authorization: `Bearer ${ghToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  const stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' }) : null;

  try {
    // 1. Read classes.json
    const fileRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${CLASSES_PATH}?ref=${branch}`,
      { headers: ghHeaders }
    );
    const file = await fileRes.json() as { sha: string; content: string };
    const data: { classes: any[] } = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));

    // 2. Find the class
    const cls = data.classes.find((c: any) => c.id === classId);
    if (!cls) return new Response(JSON.stringify({ error: 'Class not found' }), { status: 404 });

    // 3. Archive Stripe product (don't delete — preserves payment records).
    // A missing product isn't fatal: it can happen when the class was created
    // under a different Stripe mode (test vs live) — the class should still
    // be removable from the site.
    if (stripe && cls.stripeProductId) {
      try {
        await stripe.products.update(cls.stripeProductId, { active: false });
      } catch (err: any) {
        if (err?.code !== 'resource_missing') throw err;
        console.warn(`Stripe product ${cls.stripeProductId} not found in this mode — skipping archive.`);
      }
    }

    // 4. Remove from classes.json
    data.classes = data.classes.filter((c: any) => c.id !== classId);
    const newContent = Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64');

    await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${CLASSES_PATH}`,
      {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify({
          message: `Remove class: ${cls.title}`,
          content: newContent,
          sha: file.sha,
          branch,
        }),
      }
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
