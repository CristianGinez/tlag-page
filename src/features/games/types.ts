export type GameStatus = 'draft' | 'published' | 'hidden';
export type GameOrientation = 'any' | 'landscape';

export interface Game {
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  cover_url: string | null;
  controls: string | null;
  tags: string[];
  play_url: string | null;
  version: number;
  orientation: GameOrientation;
  status: GameStatus;
  display_order: number;
  published_at: string | null;
  plays: number;
  save_prefix: string | null;
  save_exclude: string[];
  created_at: string;
  updated_at: string;
}

/** Lo mínimo que necesita el reproductor (página pública o botón Probar del admin). */
export type PlayerGame = Pick<
  Game,
  'slug' | 'title' | 'cover_url' | 'play_url' | 'version' | 'orientation' | 'save_prefix' | 'save_exclude'
>;

/** Un cambio de localStorage que el conector envía para guardar en la nube. `at` en ms epoch. */
export interface SaveItem {
  key: string;
  value: string;
  at: number;
}

/** Una clave guardada en la nube, tal como la devuelve GET /api/games/saves. */
export interface CloudSave {
  value: string;
  at: number;
  updatedAt: string;
  hasPrev: boolean;
}
