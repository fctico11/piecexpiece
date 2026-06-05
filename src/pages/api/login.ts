import type { APIRoute } from 'astro';
import { createHash } from 'crypto';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const submitted = form.get('password')?.toString() ?? '';
  const expected  = import.meta.env.ADMIN_PASSWORD ?? '';

  if (!expected || submitted !== expected) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/admin?error=1' },
    });
  }

  const cookieVal = createHash('sha256').update(expected + ':pxp-editor').digest('hex');
  const isSecure  = !import.meta.env.DEV;

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/admin',
      'Set-Cookie': `pxp_auth=${cookieVal}; Path=/; HttpOnly; SameSite=Strict${isSecure ? '; Secure' : ''}; Max-Age=86400`,
    },
  });
};
