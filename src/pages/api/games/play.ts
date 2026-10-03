import type { APIRoute } from 'astro';
import { supabase } from '@/features/auth/lib/supabase';
import { checkRateLimit } from '@/shared/lib/rateLimit';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let slug: unknown;
  try { ({ slug } = await request.json()); } catch { return new Response(null, { status: 400 }); }
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) return new Response(null, { status: 400 });

  const ip = clientAddress || request.headers.get('x-forwarded-for') || 'anon';
  if (await checkRateLimit('game-play', 1, '60 s', `${ip}:${slug}`)) {
    const { error } = await supabase.rpc('increment_game_plays', { p_slug: slug });
    if (error) console.error('[games] play:', error);
  }
  return new Response(null, { status: 204 });
};
