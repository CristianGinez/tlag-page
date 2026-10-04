import type { APIRoute } from 'astro';
import { createUserClient } from '@/features/auth/lib/supabase';

export const prerender = false;
const SLUG = /^[a-z0-9-]+$/;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const h = request.headers.get('authorization');
  if (!h?.startsWith('Bearer ')) return json({ error: 'No autenticado' }, 401);
  const game = url.searchParams.get('game') ?? '';
  if (!SLUG.test(game)) return json({ error: 'Juego inválido' }, 400);

  const client = createUserClient(h.slice(7));
  const { data: { user } } = await client.auth.getUser(h.slice(7));
  if (!user) return json({ error: 'No autenticado' }, 401);

  const { data, error } = await client.rpc('get_my_game_scores', { p_game: game });
  if (error) {
    console.error('[scores] me:', error);
    return json({ error: 'No se pudieron cargar tus marcas' }, 500);
  }
  return json(data);
};
