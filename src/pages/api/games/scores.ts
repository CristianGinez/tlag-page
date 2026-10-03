import type { APIRoute } from 'astro';
import { supabase, createUserClient } from '@/features/auth/lib/supabase';
import { getCached, invalidateCache } from '@/shared/lib/cache';
import { checkRateLimit } from '@/shared/lib/rateLimit';
import { BOARD_RE } from '@/features/games/lib/scores';

export const prerender = false;
const SLUG = /^[a-z0-9-]+$/;
const KNOWN_ERRORS: Record<string, number> = {
  time_out_of_range: 400, bad_board: 400, bad_rank: 400, bad_stats: 400, game_not_found: 404, not_authenticated: 401,
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function bearer(request: Request) {
  const h = request.headers.get('authorization');
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

export const GET: APIRoute = async ({ request, url }) => {
  const game = url.searchParams.get('game') ?? '';
  const board = url.searchParams.get('board') ?? '';
  if (!SLUG.test(game) || !BOARD_RE.test(board)) return json({ error: 'Datos inválidos' }, 400);

  const token = bearer(request);
  if (token) {
    // Con sesión no se cachea: is_me depende del usuario
    try {
      const { data, error } = await createUserClient(token).rpc('get_game_leaderboard', { p_game: game, p_board: board, p_limit: 10 });
      if (!error) return json({ rows: data ?? [] });
      console.error('[scores] leaderboard (token):', error);
    } catch (err) {
      console.error('[scores] leaderboard (token):', err);
    }
    // Token caducado o inválido: se cae al camino anónimo (is_me: false)
  }
  try {
    const rows = await getCached({ key: `scores:${game}:${board}`, ttl: 60 }, async () => {
      const { data, error } = await supabase.rpc('get_game_leaderboard', { p_game: game, p_board: board, p_limit: 10 });
      if (error) throw error;
      return data ?? [];
    });
    return json({ rows });
  } catch (err) {
    console.error('[scores] leaderboard:', err);
    return json({ error: 'No se pudo cargar el marcador' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const token = bearer(request);
  if (!token) return json({ error: 'No autenticado' }, 401);
  const client = createUserClient(token);
  const { data: { user } } = await client.auth.getUser(token);
  if (!user) return json({ error: 'No autenticado' }, 401);
  if (!(await checkRateLimit('game-scores', 5, '1 m', user.id))) return json({ error: 'Demasiados envíos' }, 429);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Datos inválidos' }, 400);
  const { game, board, time_ms, rank, stats } = body;
  if (typeof game !== 'string' || !SLUG.test(game) || typeof board !== 'string' || !BOARD_RE.test(board)
      || typeof time_ms !== 'number' || !Number.isFinite(time_ms) || typeof rank !== 'string') {
    return json({ error: 'Datos inválidos' }, 400);
  }
  if (!Number.isInteger(Math.round(time_ms)) || time_ms <= 0 || time_ms > 2147483647) {
    return json({ error: 'time_out_of_range' }, 400);
  }

  const { data, error } = await client.rpc('submit_game_score', {
    p_game: game, p_board: board, p_time_ms: Math.round(time_ms), p_rank: rank, p_stats: stats ?? {},
  });
  if (error) {
    const code = Object.keys(KNOWN_ERRORS).find((k) => error.message.includes(k));
    if (code) return json({ error: code }, KNOWN_ERRORS[code]);
    console.error('[scores] submit:', error);
    return json({ error: 'Error al publicar' }, 500);
  }
  await invalidateCache(`scores:${game}:${board}`);
  return json(data);
};
