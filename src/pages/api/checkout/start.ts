import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import classes from '../../../data/classes.json';

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  const { classId } = await request.json() as { classId: string };
  if (!classId) return new Response(JSON.stringify({ error: 'Missing classId' }), { status: 400 });

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return new Response(JSON.stringify({ error: 'Stripe not configured' }), { status: 500 });

  const stripe = new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' });

  const cls = (classes.classes as any[]).find((c: any) => c.id === classId);
  if (!cls) return new Response(JSON.stringify({ error: 'Class not found' }), { status: 404 });

  // Check tickets remaining
  const remaining = cls.totalTickets - (cls.ticketsSold || 0);
  if (remaining <= 0) {
    return new Response(JSON.stringify({ error: 'This class is sold out' }), { status: 409 });
  }

  try {
    const origin = url.origin;
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: 'payment',
      line_items: [
        {
          price: cls.stripePriceId,
          quantity: 1,
        },
      ],
      return_url: `${origin}/classes/success?session_id={CHECKOUT_SESSION_ID}&class=${encodeURIComponent(cls.title)}&location=${encodeURIComponent(cls.location ?? '')}`,
      metadata: { classId, className: cls.title },
    });

    return new Response(JSON.stringify({ clientSecret: session.client_secret }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
