import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { readShopData } from '../../../lib/shopStore';

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  let items: { id: string; qty: number }[];
  try {
    ({ items } = await request.json() as { items: { id: string; qty: number }[] });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return new Response(JSON.stringify({ error: 'Your cart is empty' }), { status: 400 });
  }

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return new Response(JSON.stringify({ error: 'Stripe not configured' }), { status: 500 });
  const stripe = new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' });

  try {
    const { data } = await readShopData();
    const origin = url.origin;
    // Stripe can only display images it can fetch, so skip them on localhost
    const canUseImages = origin.startsWith('https://');

    let subtotalCents = 0;
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    for (const item of items) {
      const qty = Math.floor(item.qty);
      if (!qty || qty < 1) continue;
      const product = data.products.find(p => p.id === item.id);
      if (!product) {
        return new Response(JSON.stringify({ error: 'One of the items in your cart is no longer available.' }), { status: 409 });
      }
      const remaining = product.quantity - (product.sold || 0);
      if (remaining < qty) {
        return new Response(JSON.stringify({
          error: remaining <= 0
            ? `"${product.title}" just sold out.`
            : `Only ${remaining} of "${product.title}" left — please update your cart.`,
        }), { status: 409 });
      }

      const unitAmount = Math.round(product.price * 100);
      subtotalCents += unitAmount * qty;
      lineItems.push({
        price_data: {
          currency: 'usd',
          unit_amount: unitAmount,
          product_data: {
            name: product.title,
            description: product.dimensions ? `Handmade · ${product.dimensions}` : 'Handmade by Piece x Piece',
            ...(canUseImages ? { images: [`${origin}${product.image}`] } : {}),
          },
        },
        quantity: qty,
      });
    }

    if (lineItems.length === 0) {
      return new Response(JSON.stringify({ error: 'Your cart is empty' }), { status: 400 });
    }

    // Compact cart encoding for the webhook (metadata values max 500 chars)
    const cartCode = items.filter(i => i.qty >= 1).map(i => `${i.id}:${Math.floor(i.qty)}`).join(',');
    if (cartCode.length > 480) {
      return new Response(JSON.stringify({ error: 'Cart is too large — please check out in smaller batches.' }), { status: 400 });
    }

    // Shipping options from admin settings
    const s = data.settings;
    const freeShipping = s.freeShippingThresholdCents != null && subtotalCents >= s.freeShippingThresholdCents;
    const shippingOptions: Stripe.Checkout.SessionCreateParams.ShippingOption[] = [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: freeShipping ? 'Free shipping' : 'Standard shipping',
          fixed_amount: { amount: freeShipping ? 0 : s.flatShippingCents, currency: 'usd' },
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 5 },
            maximum: { unit: 'business_day', value: 10 },
          },
        },
      },
    ];
    if (s.localPickupEnabled) {
      shippingOptions.push({
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: 'Local pickup (we\'ll email you to arrange)',
          fixed_amount: { amount: 0, currency: 'usd' },
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: 'payment',
      line_items: lineItems,
      allow_promotion_codes: true,
      shipping_address_collection: { allowed_countries: ['US'] },
      shipping_options: shippingOptions,
      payment_intent_data: {
        description: `Piece x Piece shop order (${lineItems.length} item${lineItems.length !== 1 ? 's' : ''})`,
      },
      custom_text: {
        after_submit: {
          message: 'Every piece is handmade and packed with care — please allow a few days for it to ship. Thank you for supporting a small studio! ✦',
        },
      },
      return_url: `${origin}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
      metadata: { shopItems: cartCode },
    });

    return new Response(JSON.stringify({ clientSecret: session.client_secret }), { status: 200 });
  } catch (err: any) {
    console.error('Shop checkout error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
