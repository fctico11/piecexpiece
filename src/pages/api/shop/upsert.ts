import type { APIRoute } from 'astro';
import { isAdminAuthorized, readShopData, writeShopData, writeShopImage } from '../../../lib/shopStore';
import type { ShopProduct } from '../../../lib/shopStore';

export const prerender = false;

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAdminAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: {
    id?: string;
    title: string;
    description: string;
    price: number;
    stockMode?: 'limited' | 'made_to_order';
    quantity: number | null;
    category?: string | null;
    dimensions?: string | null;
    badge?: string | null;
    images?: { url?: string; base64?: string; ext?: string }[];
  };

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const stockMode = body.stockMode === 'made_to_order' ? 'made_to_order' : 'limited';

  if (!body.title?.trim())            return new Response(JSON.stringify({ error: 'Title is required' }), { status: 400 });
  if (!body.price || body.price <= 0) return new Response(JSON.stringify({ error: 'A valid price is required' }), { status: 400 });
  if (stockMode === 'limited' && (!body.quantity || body.quantity < 1)) {
    return new Response(JSON.stringify({ error: 'Quantity must be at least 1' }), { status: 400 });
  }

  const isEdit = !!body.id;

  try {
    const { data, sha } = await readShopData();

    // Generate a unique id for new products
    let productId = body.id ?? slugify(body.title);
    if (!isEdit && data.products.some(p => p.id === productId)) {
      productId = `${productId}-${Date.now().toString(36)}`;
    }

    const existing = isEdit ? data.products.find(p => p.id === productId) : undefined;
    if (isEdit && !existing) {
      return new Response(JSON.stringify({ error: 'Product not found' }), { status: 404 });
    }

    // Upload any newly-added photos, keep existing ones as-is, in the given order
    let images: string[] = [];
    if (body.images?.length) {
      let i = 0;
      for (const img of body.images) {
        if (img.url) {
          images.push(img.url);
        } else if (img.base64) {
          const ext = img.ext || 'jpg';
          const fileName = `${productId}-${Date.now().toString(36)}-${i}.${ext}`;
          images.push(await writeShopImage(fileName, img.base64, `${isEdit ? 'Update' : 'Add'} shop image: ${productId}`));
        }
        i++;
      }
    } else {
      images = existing?.images ?? [];
    }
    images = images.slice(0, 8);
    if (images.length === 0) {
      return new Response(JSON.stringify({ error: 'Please upload at least one product photo' }), { status: 400 });
    }

    const entry: ShopProduct = {
      id:          productId,
      title:       body.title.trim(),
      description: body.description?.trim() ?? '',
      price:       body.price,
      stockMode,
      quantity:    stockMode === 'limited' ? body.quantity : null,
      sold:        existing?.sold ?? 0,
      category:    body.category?.trim() || null,
      dimensions:  body.dimensions?.trim() || null,
      badge:       body.badge?.trim() || null,
      image:       images[0],
      images,
    };

    if (existing) {
      data.products[data.products.indexOf(existing)] = entry;
    } else {
      data.products.unshift(entry);
    }

    await writeShopData(data, `${isEdit ? 'Update' : 'Add'} shop item: ${entry.title}`, sha);

    return new Response(JSON.stringify({ ok: true, productId }), { status: 200 });
  } catch (err: any) {
    console.error('Shop upsert error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
