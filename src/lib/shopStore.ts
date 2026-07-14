import { createHash } from 'crypto';

// ── Shop data store ──────────────────────────────────────────────────────────
// In production, products.json and product images live in the GitHub repo and
// every write is a commit (same pattern as classes — each commit triggers a
// Vercel redeploy). In local dev we read/write the filesystem directly instead,
// so testing the shop never creates commits or deploys.

const PRODUCTS_PATH = 'src/data/products.json';
export const SHOP_IMAGES_DIR = 'public/images/shop';

export interface ShopSettings {
  flatShippingCents: number;
  freeShippingThresholdCents: number | null;
  localPickupEnabled: boolean;
}

export interface ShopProduct {
  id: string;
  title: string;
  description: string;
  price: number;
  quantity: number;
  sold: number;
  category: string | null;
  dimensions: string | null;
  badge: string | null;
  image: string;
}

export interface ShopData {
  settings: ShopSettings;
  products: ShopProduct[];
}

export function isAdminAuthorized(request: Request): boolean {
  const password = import.meta.env.ADMIN_PASSWORD ?? '';
  const cookie   = request.headers.get('cookie') ?? '';
  const match    = cookie.match(/(?:^|;\s*)pxp_auth=([^;]+)/);
  const expected = createHash('sha256').update(password + ':pxp-editor').digest('hex');
  return !!match && match[1] === expected;
}

const isDev = import.meta.env.DEV;

function ghHeaders() {
  return {
    Authorization: `Bearer ${import.meta.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function githubGet(path: string): Promise<{ sha: string; content: string } | null> {
  const owner  = import.meta.env.GITHUB_OWNER;
  const repo   = import.meta.env.GITHUB_REPO;
  const branch = import.meta.env.GITHUB_BRANCH ?? 'main';
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    { headers: ghHeaders() }
  );
  if (!res.ok) return null;
  return res.json() as Promise<{ sha: string; content: string }>;
}

async function githubPut(path: string, message: string, contentBase64: string, sha?: string) {
  const owner  = import.meta.env.GITHUB_OWNER;
  const repo   = import.meta.env.GITHUB_REPO;
  const branch = import.meta.env.GITHUB_BRANCH ?? 'main';
  const body: Record<string, string> = { message, content: contentBase64, branch };
  if (sha) body.sha = sha;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`GitHub write failed: ${await res.text()}`);
}

/** Read the current products file (fresh — not the build-time import). */
export async function readShopData(): Promise<{ data: ShopData; sha?: string }> {
  if (isDev) {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(PRODUCTS_PATH, 'utf8');
    return { data: JSON.parse(raw) };
  }
  const file = await githubGet(PRODUCTS_PATH);
  if (!file?.content) {
    return { data: { settings: { flatShippingCents: 1200, freeShippingThresholdCents: null, localPickupEnabled: true }, products: [] } };
  }
  return {
    data: JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')),
    sha: file.sha,
  };
}

/** Write the products file back (local fs in dev, GitHub commit in prod). */
export async function writeShopData(data: ShopData, commitMessage: string, sha?: string) {
  const json = JSON.stringify(data, null, 2) + '\n';
  if (isDev) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(PRODUCTS_PATH, json, 'utf8');
    return;
  }
  await githubPut(PRODUCTS_PATH, commitMessage, Buffer.from(json).toString('base64'), sha);
}

/** Save a product image (base64, no data: prefix). Returns the public URL path. */
export async function writeShopImage(fileName: string, base64: string, commitMessage: string): Promise<string> {
  const path = `${SHOP_IMAGES_DIR}/${fileName}`;
  if (isDev) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(SHOP_IMAGES_DIR, { recursive: true });
    await writeFile(path, Buffer.from(base64, 'base64'));
  } else {
    const existing = await githubGet(path);
    await githubPut(path, commitMessage, base64, existing?.sha);
  }
  return `/images/shop/${fileName}`;
}
