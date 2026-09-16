import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { isAdminAuthorized } from '../../../../lib/shopStore';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isAdminAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: { code: string; type: 'percent' | 'fixed'; value: number };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const code = body.code?.trim().toUpperCase();
  if (!code) return new Response(JSON.stringify({ error: 'A code is required' }), { status: 400 });
  if (!body.value || body.value <= 0) {
    return new Response(JSON.stringify({ error: 'Enter a discount value greater than 0' }), { status: 400 });
  }
  if (body.type === 'percent' && body.value > 100) {
    return new Response(JSON.stringify({ error: 'Percent off can\'t exceed 100' }), { status: 400 });
  }

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return new Response(JSON.stringify({ error: 'Stripe not configured' }), { status: 500 });
  const stripe = new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' });

  try {
    const coupon = await stripe.coupons.create({
      duration: 'once',
      name: code,
      ...(body.type === 'fixed'
        ? { amount_off: Math.round(body.value * 100), currency: 'usd' }
        : { percent_off: body.value }),
    });
    const promotionCode = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code,
    });
    return new Response(JSON.stringify({ ok: true, id: promotionCode.id }), { status: 200 });
  } catch (err: any) {
    console.error('Promo create error:', err);
    const message = err?.code === 'resource_already_exists'
      ? `Code "${code}" already exists.`
      : (err.message || 'Failed to create code');
    return new Response(JSON.stringify({ error: message }), { status: 400 });
  }
};
