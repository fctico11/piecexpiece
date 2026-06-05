import type { APIRoute } from 'astro';
import { createHash } from 'crypto';

export const prerender = false;

const TOKENS_PATH = 'src/data/tokens.json';

function expectedCookieValue() {
  const password = import.meta.env.ADMIN_PASSWORD ?? '';
  return createHash('sha256').update(password + ':pxp-editor').digest('hex');
}

function isAuthorized(request: Request): boolean {
  const cookie = request.headers.get('cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)pxp_auth=([^;]+)/);
  return match ? match[1] === expectedCookieValue() : false;
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: {
    colors: Record<string, string>;
    fonts: { heading: string; body: string };
    shapes: { style: string; vars: Record<string, string> };
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const token  = import.meta.env.GITHUB_TOKEN;
  const owner  = import.meta.env.GITHUB_OWNER;
  const repo   = import.meta.env.GITHUB_REPO;
  const branch = import.meta.env.GITHUB_BRANCH ?? 'main';

  if (!token || !owner || !repo) {
    return new Response(JSON.stringify({ error: 'GitHub env vars not configured' }), { status: 500 });
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${TOKENS_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  // Fetch current file SHA (required for updates)
  const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers });
  if (!getRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to fetch current tokens from GitHub' }), { status: 502 });
  }
  const { sha } = await getRes.json() as { sha: string };

  // Write updated tokens (merge shape vars + style into shapes object)
  const shapesOut = { style: body.shapes?.style ?? 'mosaic', ...body.shapes?.vars };
  const newContent = JSON.stringify({ colors: body.colors, fonts: body.fonts, shapes: shapesOut }, null, 2) + '\n';
  const encoded = btoa(unescape(encodeURIComponent(newContent)));

  const putRes = await fetch(apiBase, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: 'Update theme via editor portal',
      content: encoded,
      sha,
      branch,
    }),
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    return new Response(JSON.stringify({ error: 'GitHub write failed', detail: err }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
