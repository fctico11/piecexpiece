import type { APIRoute } from 'astro';
import { createHash } from 'crypto';

export const prerender = false;

const CLASSES_PATH = 'src/data/classes.json';

function isAuthorized(request: Request): boolean {
  const password = import.meta.env.ADMIN_PASSWORD ?? '';
  const cookie   = request.headers.get('cookie') ?? '';
  const match    = cookie.match(/(?:^|;\s*)pxp_auth=([^;]+)/);
  const expected = createHash('sha256').update(password + ':pxp-editor').digest('hex');
  return !!match && match[1] === expected;
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { classId, featured } = await request.json() as { classId: string; featured: boolean };
  if (!classId) return new Response(JSON.stringify({ error: 'Missing classId' }), { status: 400 });

  const ghToken  = import.meta.env.GITHUB_TOKEN;
  const branch   = import.meta.env.GITHUB_BRANCH ?? 'main';
  const owner    = import.meta.env.GITHUB_OWNER;
  const repo     = import.meta.env.GITHUB_REPO;
  const headers  = {
    Authorization: `Bearer ${ghToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  try {
    const fileRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${CLASSES_PATH}?ref=${branch}`,
      { headers }
    );
    const file = await fileRes.json() as { sha: string; content: string };
    const data: { classes: any[] } = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));

    const cls = data.classes.find((c: any) => c.id === classId);
    if (!cls) return new Response(JSON.stringify({ error: 'Class not found' }), { status: 404 });

    // Enforce max 4 featured
    if (featured) {
      const currentlyFeatured = data.classes.filter((c: any) => c.featured).length;
      if (currentlyFeatured >= 4) {
        return new Response(JSON.stringify({ error: 'Already 4 featured classes. Unfeature one first.' }), { status: 409 });
      }
    }

    cls.featured = featured;
    const newContent = Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64');

    await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${CLASSES_PATH}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: `${featured ? 'Feature' : 'Unfeature'} class: ${cls.title}`,
          content: newContent,
          sha: file.sha,
          branch,
        }),
      }
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
