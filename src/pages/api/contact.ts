import type { APIRoute } from 'astro';
import { Resend } from 'resend';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const resendKey    = import.meta.env.RESEND_API_KEY;
  const contactEmail = import.meta.env.CONTACT_EMAIL;

  if (!resendKey || !contactEmail) {
    return new Response(JSON.stringify({ error: 'Email not configured' }), { status: 500 });
  }

  const form = await request.formData();
  const requestType   = form.get('requestType')?.toString()   ?? '';
  const name          = form.get('name')?.toString()          ?? '';
  const email         = form.get('email')?.toString()         ?? '';
  const phone         = form.get('phone')?.toString()         ?? '';
  const preferredDate = form.get('preferredDate')?.toString() ?? '';
  const message       = form.get('message')?.toString()       ?? '';

  // Optional fields depending on request type
  const lessonFormat  = form.get('lessonFormat')?.toString()  ?? '';
  const lessonGoal    = form.get('lessonGoal')?.toString()    ?? '';
  const eventType     = form.get('eventType')?.toString()     ?? '';
  const groupSize     = form.get('groupSize')?.toString()     ?? '';
  const eventLocation = form.get('eventLocation')?.toString() ?? '';

  if (!name || !email || !message) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  const typeLabels: Record<string, string> = {
    'general':        'General Question',
    'public-class':   'Public Class Inquiry',
    'private-lesson': 'Private Lesson',
    'private-event':  'Private Workshop / Event',
  };
  const typeLabel = typeLabels[requestType] ?? requestType;

  // Build extra details block based on type
  const extraRows: string[] = [];
  if (phone)         extraRows.push(`<tr><td style="padding:6px 0;color:#6b7280;font-size:0.85rem;width:140px;">Phone</td><td style="padding:6px 0;color:#1a3a5c;font-size:0.85rem;">${phone}</td></tr>`);
  if (preferredDate) extraRows.push(`<tr><td style="padding:6px 0;color:#6b7280;font-size:0.85rem;">Preferred Date</td><td style="padding:6px 0;color:#1a3a5c;font-size:0.85rem;">${preferredDate}</td></tr>`);
  if (lessonFormat)  extraRows.push(`<tr><td style="padding:6px 0;color:#6b7280;font-size:0.85rem;">Lesson Format</td><td style="padding:6px 0;color:#1a3a5c;font-size:0.85rem;">${lessonFormat}</td></tr>`);
  if (lessonGoal)    extraRows.push(`<tr><td style="padding:6px 0;color:#6b7280;font-size:0.85rem;">Creative Goal</td><td style="padding:6px 0;color:#1a3a5c;font-size:0.85rem;">${lessonGoal}</td></tr>`);
  if (eventType)     extraRows.push(`<tr><td style="padding:6px 0;color:#6b7280;font-size:0.85rem;">Event Type</td><td style="padding:6px 0;color:#1a3a5c;font-size:0.85rem;">${eventType}</td></tr>`);
  if (groupSize)     extraRows.push(`<tr><td style="padding:6px 0;color:#6b7280;font-size:0.85rem;">Group Size</td><td style="padding:6px 0;color:#1a3a5c;font-size:0.85rem;">${groupSize} people</td></tr>`);
  if (eventLocation) extraRows.push(`<tr><td style="padding:6px 0;color:#6b7280;font-size:0.85rem;">Location</td><td style="padding:6px 0;color:#1a3a5c;font-size:0.85rem;">${eventLocation}</td></tr>`);

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f0ea;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0ea;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- Header -->
        <tr><td style="background:#1a3a5c;border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
          <p style="margin:0;font-size:1.3rem;font-weight:700;color:#ffffff;letter-spacing:0.02em;">Piece x Piece Mosaics</p>
          <p style="margin:6px 0 0;font-size:0.82rem;color:#5fb8b0;letter-spacing:0.08em;text-transform:uppercase;">New Inquiry</p>
        </td></tr>

        <!-- Type badge -->
        <tr><td style="background:#ffffff;padding:24px 32px 0;">
          <span style="display:inline-block;background:#e8f4f3;color:#1a3a5c;font-size:0.75rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;padding:5px 14px;border-radius:100px;">${typeLabel}</span>
        </td></tr>

        <!-- Name + email -->
        <tr><td style="background:#ffffff;padding:20px 32px 0;">
          <p style="margin:0;font-size:1.15rem;font-weight:700;color:#1a3a5c;">${name}</p>
          <a href="mailto:${email}" style="color:#5fb8b0;font-size:0.9rem;text-decoration:none;">${email}</a>
        </td></tr>

        <!-- Details table -->
        ${extraRows.length > 0 ? `
        <tr><td style="background:#ffffff;padding:16px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f0ebe4;">
            ${extraRows.join('')}
          </table>
        </td></tr>` : ''}

        <!-- Message -->
        <tr><td style="background:#ffffff;padding:20px 32px;">
          <p style="margin:0 0 8px;font-size:0.75rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#6b7280;">Message</p>
          <p style="margin:0;font-size:0.95rem;color:#374151;line-height:1.7;white-space:pre-wrap;">${message}</p>
        </td></tr>

        <!-- Reply CTA -->
        <tr><td style="background:#f8f6f2;border-top:1px solid #e8e2d9;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
          <a href="mailto:${email}?subject=Re: Your Piece x Piece Inquiry" style="display:inline-block;background:#1a3a5c;color:#ffffff;font-size:0.82rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;padding:12px 24px;border-radius:100px;text-decoration:none;">Reply to ${name}</a>
          <p style="margin:12px 0 0;font-size:0.75rem;color:#9ca3af;">Submitted via piecexpiecemosaics.com</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const resend = new Resend(resendKey);

  try {
    await resend.emails.send({
      from: 'Piece x Piece Inquiries <onboarding@resend.dev>',
      to: contactEmail,
      replyTo: email,
      subject: `New Inquiry: ${typeLabel} — ${name}`,
      html,
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error('Resend error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
