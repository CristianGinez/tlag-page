import { supabase } from '@/features/auth/lib/supabase';
import { getCached } from '@/shared/lib/cache';
import type { Game, ScoreRow } from '../types';

export async function getGames(): Promise<Game[]> {
  try {
    return await getCached({ key: 'games:all', ttl: 300 }, async () => {
      const { data, error } = await supabase
        .from('games')
        .select('*')
        .eq('status', 'published')
        .order('display_order');
      if (error) throw error;
      return (data ?? []) as Game[];
    });
  } catch (err) {
    console.error('[games] list:', err);
    return [];
  }
}

export async function getGame(slug: string): Promise<Game | null> {
  try {
    return await getCached({ key: `games:${slug}`, ttl: 300 }, async () => {
      const { data, error } = await supabase
        .from('games')
        .select('*')
        .eq('slug', slug)
        .eq('status', 'published')
        .maybeSingle();
      if (error) throw error;
      return (data as Game | null) ?? null;
    });
  } catch (err) {
    console.error('[games] get:', err);
    return null;
  }
}

/** Top público de una tabla (mismo caché que GET /api/games/scores). Nunca lanza: [] si falla. */
export async function getLeaderboard(slug: string, board: string): Promise<ScoreRow[]> {
  try {
    return await getCached({ key: `scores:${slug}:${board}`, ttl: 60 }, async () => {
      const { data, error } = await supabase.rpc('get_game_leaderboard', { p_game: slug, p_board: board, p_limit: 10 });
      if (error) throw error;
      return (data ?? []) as ScoreRow[];
    });
  } catch (err) {
    console.error('[games] leaderboard:', err);
    return [];
  }
}
