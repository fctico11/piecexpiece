import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { readShopData, writeShopData } from '../../../lib/shopStore';

export const prerender = false;

const CLASSES_PATH = 'src/data/classes.json';

// ── Class ticket sold: bump ticketsSold in classes.json via GitHub ──────────
async function handleClassSale(classId: string) {
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

// ── Shop order: decrement stock + notify the owner ──────────────────────────
async function handleShopOrder(stripe: Stripe, session: Stripe.Checkout.Session, cartCode: string) {
  // cartCode format: "product-id:qty,product-id:qty"
  const items = cartCode.split(',').map(pair => {
    const idx = pair.lastIndexOf(':');
    return { id: pair.slice(0, idx), qty: parseInt(pair.slice(idx + 1)) || 1 };
  });

  // 1. Decrement stock
  const soldTitles: string[] = [];
  try {
    const { data, sha } = await readShopData();
    for (const item of items) {
      const product = data.products.find(p => p.id === item.id);
      if (product) {
        product.sold = (product.sold || 0) + item.qty;
        soldTitles.push(`${product.title} ×${item.qty}`);
      }
    }
    const summary = soldTitles.join(', ').slice(0, 60);
    await writeShopData(data, `Shop order: ${summary}${soldTitles.join(', ').length > 60 ? '…' : ''}`, sha);
  } catch (err) {
    console.error('Webhook error updating shop stock:', err);
  }

  // 2. Email the owner so she knows what to pack and where to send it
  const resendKey    = import.meta.env.RESEND_API_KEY;
  const contactEmail = import.meta.env.CONTACT_EMAIL;
  if (!resendKey || !contactEmail) return;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(resendKey);

    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
    const customer  = session.customer_details;
    const shipping  = (session as any).collected_information?.shipping_details
                   ?? (session as any).shipping_details
                   ?? null;
    const addr = shipping?.address;

    let shippingMethod = 'Standard shipping';
    const shippingRateId = typeof session.shipping_cost?.shipping_rate === 'string'
      ? session.shipping_cost.shipping_rate
      : session.shipping_cost?.shipping_rate?.id;
    if (shippingRateId) {
      try {
        const rate = await stripe.shippingRates.retrieve(shippingRateId);
        shippingMethod = rate.display_name || shippingMethod;
      } catch { /* keep default label */ }
    }

    const fmt = (cents: number | null | undefined) =>
      `$${((cents ?? 0) / 100).toFixed(2)}`;

    const itemRows = lineItems.data.map(li => `
      <tr>
        <td style="padding:8px 0;color:#1a3a5c;font-size:0.9rem;">${li.description} <span style="color:#6b7280;">×${li.quantity}</span></td>
        <td style="padding:8px 0;color:#1a3a5c;font-size:0.9rem;text-align:right;">${fmt(li.amount_total)}</td>
      </tr>`).join('');

    const addressBlock = addr ? `
      <p style="margin:0;font-size:0.95rem;color:#374151;line-height:1.7;">
        ${shipping?.name ?? customer?.name ?? ''}<br>
        ${addr.line1 ?? ''}${addr.line2 ? '<br>' + addr.line2 : ''}<br>
        ${addr.city ?? ''}, ${addr.state ?? ''} ${addr.postal_code ?? ''}<br>
        ${addr.country ?? ''}
      </p>` : '<p style="margin:0;color:#6b7280;font-size:0.9rem;">No shipping address collected.</p>';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f0ea;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0ea;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <tr><td style="background:#1a3a5c;border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
          <p style="margin:0;font-size:1.3rem;font-weight:700;color:#ffffff;letter-spacing:0.02em;">Piece x Piece Mosaics</p>
          <p style="margin:6px 0 0;font-size:0.82rem;color:#5fb8b0;letter-spacing:0.08em;text-transform:uppercase;">🎉 New Shop Order</p>
        </td></tr>

        <tr><td style="background:#ffffff;padding:24px 32px 0;">
          <p style="margin:0;font-size:1.15rem;font-weight:700;color:#1a3a5c;">${customer?.name ?? 'Customer'}</p>
          <a href="mailto:${customer?.email ?? ''}" style="color:#5fb8b0;font-size:0.9rem;text-decoration:none;">${customer?.email ?? ''}</a>
        </td></tr>

        <tr><td style="background:#ffffff;padding:20px 32px 0;">
          <p style="margin:0 0 4px;font-size:0.75rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#6b7280;">Items</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f0ebe4;">
            ${itemRows}
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:0.85rem;border-top:1px solid #f0ebe4;">${shippingMethod}</td>
              <td style="padding:8px 0;color:#6b7280;font-size:0.85rem;text-align:right;border-top:1px solid #f0ebe4;">${fmt(session.shipping_cost?.amount_total)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#1a3a5c;font-size:0.95rem;font-weight:700;">Total paid</td>
              <td style="padding:8px 0;color:#1a3a5c;font-size:0.95rem;font-weight:700;text-align:right;">${fmt(session.amount_total)}</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="background:#ffffff;padding:16px 32px 24px;">
          <p style="margin:0 0 8px;font-size:0.75rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#6b7280;">Ship to</p>
          ${addressBlock}
        </td></tr>

        <tr><td style="background:#f8f6f2;border-top:1px solid #e8e2d9;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
          <a href="https://dashboard.stripe.com/payments" style="display:inline-block;background:#1a3a5c;color:#ffffff;font-size:0.82rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;padding:12px 24px;border-radius:100px;text-decoration:none;">View in Stripe</a>
          <p style="margin:12px 0 0;font-size:0.75rem;color:#9ca3af;">Order placed via piecexpiece-mosaics.com/shop</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await resend.emails.send({
      from: 'Piece x Piece Shop <onboarding@resend.dev>',
      to: contactEmail,
      replyTo: customer?.email ?? undefined,
      subject: `New shop order — ${fmt(session.amount_total)} (${soldTitles.join(', ').slice(0, 80) || 'order'})`,
      html,
    });
  } catch (err) {
    console.error('Webhook error sending shop order email:', err);
  }
}

export const POST: APIRoute = async ({ request }) => {
  const stripeKey     = import.meta.env.STRIPE_SECRET_KEY;
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
    const session   = event.data.object as Stripe.Checkout.Session;
    const classId   = session.metadata?.classId;
    const shopItems = session.metadata?.shopItems;

    if (shopItems) {
      await handleShopOrder(stripe, session, shopItems);
    } else if (classId) {
      await handleClassSale(classId);
    }
  }

  return new Response('OK', { status: 200 });
};
