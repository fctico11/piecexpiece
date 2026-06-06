import type { APIRoute } from 'astro';
import Stripe from 'stripe';

export const prerender = false;

const CLASSES_PATH = 'src/data/classes.json';

export const POST: APIRoute = async ({ request }) => {
  const stripeKey    = import.meta.env.STRIPE_SECRET_KEY;
  const webhookSecret = import.meta.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    return new Response('Stripe not configured', { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' });
  const body   = await request.text();
  const sig    = request.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch {
    return new Response('Webhook signature verification failed', { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session  = event.data.object as Stripe.Checkout.Session;
    const classId  = session.metadata?.classId;
    if (!classId) return new Response('OK', { status: 200 });

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

    try {
      const fileRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${CLASSES_PATH}?ref=${branch}`,
        { headers: ghHeaders }
      );
      const file = await fileRes.json() as { sha: string; content: string };
      const data: { classes: any[] } = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));

      const cls = data.classes.find((c: any) => c.id === classId);
      if (cls) {
        cls.ticketsSold = (cls.ticketsSold || 0) + 1;
        const newContent = Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64');
        await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${CLASSES_PATH}`,
          {
            method: 'PUT',
            headers: ghHeaders,
            body: JSON.stringify({
              message: `Ticket sold: ${cls.title} (${cls.ticketsSold}/${cls.totalTickets})`,
              content: newContent,
              sha: file.sha,
              branch,
            }),
          }
        );
      }
    } catch (err) {
      console.error('Webhook error updating ticket count:', err);
    }
  }

  return new Response('OK', { status: 200 });
};
