import { supabase } from '@/features/auth/lib/supabase';
import { getCached } from '@/shared/lib/cache';
import type { Game } from '../types';

export async function getGames(): Promise<Game[]> {
  return getCached({ key: 'games:all', ttl: 300 }, async () => {
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('status', 'published')
      .order('display_order');
    if (error) {
      console.error('[games] list:', error);
      return [];
    }
    return (data ?? []) as Game[];
  });
}

export async function getGame(slug: string): Promise<Game | null> {
  return getCached({ key: `games:${slug}`, ttl: 300 }, async () => {
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();
    if (error) {
      console.error('[games] get:', error);
      return null;
    }
    return (data as Game | null) ?? null;
  });
}
