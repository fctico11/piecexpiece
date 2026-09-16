import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { isAdminAuthorized } from '../../../../lib/shopStore';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isAdminAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: { id: string; active: boolean };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  if (!body.id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return new Response(JSON.stringify({ error: 'Stripe not configured' }), { status: 500 });
  const stripe = new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' });

  try {
    await stripe.promotionCodes.update(body.id, { active: !!body.active });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error('Promo toggle error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Failed to update code' }), { status: 500 });
  }
};
