import type { APIRoute } from 'astro';
import { createServiceClient } from '@/features/auth/lib/supabase';
import { checkRateLimit } from '@/shared/lib/rateLimit';
import { achievementBadge } from '@/features/games/lib/achievements';
import { getBadges } from '@/features/achievements/lib/achievementsData';

export const prerender = false;
const SLUG = /^[a-z0-9-]+$/;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

/** POST { game, id } con Bearer: otorga el badge que ese juego tiene asociado a ese logro (idempotente). */
export const POST: APIRoute = async ({ request }) => {
  const h = request.headers.get('authorization');
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return json({ error: 'No autenticado' }, 401);
  const service = createServiceClient();
  const { data: { user } } = await service.auth.getUser(token);
  if (!user) return json({ error: 'No autenticado' }, 401);
  if (!(await checkRateLimit('game-achievements', 5, '1 m', user.id))) return json({ error: 'Demasiados envíos' }, 429);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const game = typeof body?.game === 'string' && SLUG.test(body.game) ? body.game : null;
  const badgeSlug = game ? achievementBadge(game, body.id) : null;
  if (!badgeSlug) return json({ error: 'unknown_achievement' }, 404);

  const { data: granted, error } = await service.rpc('grant_badge', { target_user_id: user.id, badge_slug: badgeSlug });
  if (error) {
    console.error('[games/achievement] grant:', error);
    return json({ error: 'Error al otorgar' }, 500);
  }
  const badge = (await getBadges(user.id)).find((b) => b.slug === badgeSlug && b.unlocked) ?? null;
  return json({ status: granted ? 'granted' : 'already', badge });
};
