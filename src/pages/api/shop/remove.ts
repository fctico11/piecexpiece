import type { APIRoute } from 'astro';
import { isAdminAuthorized, readShopData, writeShopData } from '../../../lib/shopStore';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isAdminAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let productId: string;
  try {
    ({ productId } = await request.json() as { productId: string });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  if (!productId) return new Response(JSON.stringify({ error: 'Missing productId' }), { status: 400 });

  try {
    const { data, sha } = await readShopData();
    const product = data.products.find(p => p.id === productId);
    if (!product) return new Response(JSON.stringify({ error: 'Product not found' }), { status: 404 });

    data.products = data.products.filter(p => p.id !== productId);
    await writeShopData(data, `Remove shop item: ${product.title}`, sha);

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error('Shop remove error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
