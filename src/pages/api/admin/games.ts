import type { APIRoute } from 'astro';
import { createServiceClient } from '@/features/auth/lib/supabase';
import { invalidateCache } from '@/shared/lib/cache';

export const prerender = false;

const EDITABLE = [
  'title', 'tagline', 'description', 'cover_url', 'controls', 'tags', 'play_url', 'version',
  'orientation', 'status', 'display_order', 'save_prefix', 'save_exclude', 'boards',
] as const;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// PKCE: la sesión vive en localStorage, el token llega por Authorization
async function requireAdmin(context: Parameters<APIRoute>[0]) {
  const authHeader = context.request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const service = createServiceClient();
  const { data: { user } } = await service.auth.getUser(authHeader.slice(7));
  if (!user) return null;
  const { data } = await service.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
  return data ? user : null;
}

function pickEditable(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) out[k] = body[k];
  if (typeof out.play_url === 'string' && out.play_url.trim() === '') out.play_url = null;
  if (typeof out.save_prefix === 'string' && out.save_prefix.trim() === '') out.save_prefix = null;
  return out;
}

async function invalidate(slug: string) {
  await Promise.all([invalidateCache('games:all'), invalidateCache(`games:${slug}`)]);
}

export const GET: APIRoute = async (context) => {
  if (!(await requireAdmin(context))) return json({ error: 'No autorizado' }, 403);
  const { data, error } = await createServiceClient().from('games').select('*').order('display_order');
  if (error) return json({ error: error.message }, 500);
  return json({ games: data ?? [] });
};

export const POST: APIRoute = async (context) => {
  if (!(await requireAdmin(context))) return json({ error: 'No autorizado' }, 403);
  let body: Record<string, unknown>;
  try { body = await context.request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  if (!/^[a-z0-9-]+$/.test(slug)) return json({ error: 'Slug inválido (a-z, 0-9, -)' }, 400);
  if (typeof body.title !== 'string' || !body.title.trim()) return json({ error: 'Falta el título' }, 400);

  const row: Record<string, unknown> = { ...pickEditable(body), slug };
  if (row.status === 'published') row.published_at = new Date().toISOString();

  const { data, error } = await createServiceClient().from('games').insert(row).select('*').single();
  if (error) return json({ error: error.message }, 400);
  await invalidate(slug);
  return json({ game: data });
};

export const PATCH: APIRoute = async (context) => {
  if (!(await requireAdmin(context))) return json({ error: 'No autorizado' }, 403);
  const slug = context.url.searchParams.get('slug');
  if (!slug) return json({ error: 'Falta slug' }, 400);
  let body: Record<string, unknown>;
  try { body = await context.request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const service = createServiceClient();
  const patch: Record<string, unknown> = { ...pickEditable(body), updated_at: new Date().toISOString() };
  if (patch.status === 'published') {
    const { data: current } = await service.from('games').select('published_at').eq('slug', slug).maybeSingle();
    if (current && !current.published_at) patch.published_at = new Date().toISOString();
  }

  const { data, error } = await service.from('games').update(patch).eq('slug', slug).select('*').single();
  if (error) return json({ error: error.message }, 400);
  await invalidate(slug);
  return json({ game: data });
};

export const DELETE: APIRoute = async (context) => {
  if (!(await requireAdmin(context))) return json({ error: 'No autorizado' }, 403);
  const slug = context.url.searchParams.get('slug');
  if (!slug) return json({ error: 'Falta slug' }, 400);
  const { error } = await createServiceClient().from('games').delete().eq('slug', slug);
  if (error) return json({ error: error.message }, 400);
  await invalidate(slug);
  return json({ ok: true });
};
