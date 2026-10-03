/** Origen de la web (donde vive la sesión). */
export const SITE_ORIGIN: string =
  (import.meta.env.PUBLIC_SITE_ORIGIN as string | undefined) || 'https://www.tlag.online';

/** Origen aislado desde el que se sirven los juegos (/g/<slug>/). */
export const GAMES_ORIGIN: string =
  (import.meta.env.PUBLIC_GAMES_ORIGIN as string | undefined) || 'https://juegos.tlag.online';
