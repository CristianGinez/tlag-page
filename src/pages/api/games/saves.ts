import type { APIRoute } from 'astro';
import { createUserClient } from '@/features/auth/lib/supabase';
import { checkRateLimit } from '@/shared/lib/rateLimit';
import type { CloudSave } from '@/features/games/types';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function auth(request: Request) {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  const client = createUserClient(token);
  const { data: { user } } = await client.auth.getUser(token);
  return user ? { client, user } : null;
}

const SLUG = /^[a-z0-9-]+$/;

export const GET: APIRoute = async ({ request, url }) => {
  const a = await auth(request);
  if (!a) return json({ error: 'No autenticado' }, 401);
  const game = url.searchParams.get('game') ?? '';
  if (!SLUG.test(game)) return json({ error: 'Juego inválido' }, 400);

  const { data, error } = await a.client
    .from('game_saves')
    .select('key, value, prev_value, client_at, updated_at')
    .eq('game_slug', game);
  if (error) return json({ error: error.message }, 500);

  const saves: Record<string, CloudSave> = {};
  for (const row of data ?? []) {
    saves[row.key] = {
      value: row.value,
      at: Date.parse(row.client_at),
      updatedAt: row.updated_at,
      hasPrev: row.prev_value !== null,
    };
  }
  return json({ saves });
};

export const PUT: APIRoute = async ({ request }) => {
  const a = await auth(request);
  if (!a) return json({ error: 'No autenticado' }, 401);
  if (!(await checkRateLimit('game-saves', 30, '1 m', a.user.id))) return json({ error: 'Demasiados guardados' }, 429);

  let body: { game?: unknown; items?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (typeof body.game !== 'string' || !SLUG.test(body.game) || !Array.isArray(body.items)) {
    return json({ error: 'Datos inválidos' }, 400);
  }

  const { data, error } = await a.client.rpc('upsert_game_saves', { p_game: body.game, p_items: body.items });
  if (error) {
    if (error.message.includes('game_not_saveable')) return json({ error: 'Juego sin guardado' }, 404);
    if (error.message.includes('bad_items')) return json({ error: 'Demasiadas claves' }, 400);
    if (error.message.includes('not_authenticated')) return json({ error: 'No autenticado' }, 401);
    return json({ error: error.message }, 500);
  }
  return json(data);
};

export const POST: APIRoute = async ({ request, url }) => {
  const a = await auth(request);
  if (!a) return json({ error: 'No autenticado' }, 401);
  const game = url.searchParams.get('game') ?? '';
  if (!SLUG.test(game) || url.searchParams.get('action') !== 'restore') return json({ error: 'Acción inválida' }, 400);

  const { data, error } = await a.client.rpc('restore_game_saves', { p_game: game });
  if (error) return json({ error: error.message }, 500);
  return json({ restored: data ?? 0 });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const a = await auth(request);
  if (!a) return json({ error: 'No autenticado' }, 401);
  const game = url.searchParams.get('game') ?? '';
  if (!SLUG.test(game)) return json({ error: 'Juego inválido' }, 400);

  const { error } = await a.client.from('game_saves').delete().eq('game_slug', game);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
