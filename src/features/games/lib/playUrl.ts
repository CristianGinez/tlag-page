import type { Game } from '../types';
import { GAMES_ORIGIN } from './origins';

type PlayTarget = Pick<Game, 'slug' | 'play_url' | 'version'>;

export function getPlayUrl(game: PlayTarget, gamesOrigin: string = GAMES_ORIGIN): string {
  // index.html explícito: el servidor de dev (Vite) no resuelve index.html en URLs de carpeta
  const base = game.play_url?.trim() || `${gamesOrigin.replace(/\/+$/, '')}/g/${game.slug}/index.html`;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}v=${game.version}`;
}

export function getPlayOrigin(game: PlayTarget, gamesOrigin: string = GAMES_ORIGIN): string {
  return new URL(getPlayUrl(game, gamesOrigin)).origin;
}
