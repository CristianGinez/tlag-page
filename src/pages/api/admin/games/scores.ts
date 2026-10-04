import type { APIRoute } from 'astro';
import { createServiceClient } from '@/features/auth/lib/supabase';
import { invalidateCache } from '@/shared/lib/cache';

export const prerender = false;
const SLUG = /^[a-z0-9-]+$/;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function requireAdmin(request: Request) {
  const h = request.headers.get('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  const service = createServiceClient();
  const { data: { user } } = await service.auth.getUser(h.slice(7));
  if (!user) return null;
  const { data } = await service.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
  return data ? user : null;
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await requireAdmin(request))) return json({ error: 'No autorizado' }, 403);
  const game = url.searchParams.get('game') ?? '';
  if (!SLUG.test(game)) return json({ error: 'Juego inválido' }, 400);

  const service = createServiceClient();
  const { data, error } = await service
    .from('game_scores')
    .select('id, user_id, board, time_ms, rank, created_at')
    .eq('game_slug', game)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return json({ error: error.message }, 500);

  const ids = [...new Set((data ?? []).map((s) => s.user_id))];
  const { data: profiles } = ids.length
    ? await service.from('profiles').select('id, display_name').in('id', ids)
    : { data: [] as { id: string; display_name: string | null }[] };
  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? 'Jugador']));

  return json({
    scores: (data ?? []).map(({ user_id, ...s }) => ({ ...s, name: names.get(user_id) ?? 'Jugador' })),
  });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  if (!(await requireAdmin(request))) return json({ error: 'No autorizado' }, 403);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'id inválido' }, 400);

  const service = createServiceClient();
  const { data: row } = await service.from('game_scores').select('game_slug, board').eq('id', id).maybeSingle();
  if (!row) return json({ error: 'No existe' }, 404);
  const { error } = await service.from('game_scores').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);
  await invalidateCache(`scores:${row.game_slug}:${row.board}`);
  return json({ ok: true });
};
