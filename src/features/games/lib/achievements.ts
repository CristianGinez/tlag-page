// Logros que un juego puede pedir para el perfil del jugador (TL.request('unlockAchievement', { id })).
// Cada id del juego apunta a un badge de la tabla `badges`. Lo que no está acá se rechaza.
export const GAME_ACHIEVEMENTS: Record<string, Record<string, string>> = {
  'lima-infecta': {
    'archivo-completo': 'lima-archivo-completo',
  },
};

export const ACHIEVEMENT_RE = /^[a-z0-9-]{1,40}$/;

/** Slug del badge para (juego, logro), o null si ese juego no da ese logro. */
export function achievementBadge(game: string, id: unknown): string | null {
  if (typeof id !== 'string' || !ACHIEVEMENT_RE.test(id)) return null;
  const list = GAME_ACHIEVEMENTS[game];
  return (list && Object.prototype.hasOwnProperty.call(list, id) && list[id]) || null;
}
