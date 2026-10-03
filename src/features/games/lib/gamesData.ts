import { supabase } from '@/features/auth/lib/supabase';
import { getCached } from '@/shared/lib/cache';
import type { Game } from '../types';

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
