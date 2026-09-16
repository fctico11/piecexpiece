import type { APIRoute } from 'astro';
import { isAdminAuthorized, readShopData, writeShopData } from '../../../lib/shopStore';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isAdminAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: { flatShipping: number; freeShippingOver?: number | null };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  if (typeof body.flatShipping !== 'number' || body.flatShipping < 0) {
    return new Response(JSON.stringify({ error: 'Invalid shipping rate' }), { status: 400 });
  }

  try {
    const { data, sha } = await readShopData();
    data.settings = {
      flatShippingCents: Math.round(body.flatShipping * 100),
      freeShippingThresholdCents:
        body.freeShippingOver && body.freeShippingOver > 0 ? Math.round(body.freeShippingOver * 100) : null,
    };
    await writeShopData(data, 'Update shop shipping settings', sha);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error('Shop settings error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
