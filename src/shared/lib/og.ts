const SITE_URL = import.meta.env.SITE || 'https://www.tlag.online';

export function ogUrl(path: string): string {
  return `${SITE_URL}/og/${path}.png`;
}

export const ogDefault = () => `${SITE_URL}/og/default.png`;
export const ogCategoria = (id: string) => ogUrl(`categoria/${id}`);
export const ogEvento = (slug: string) => ogUrl(`evento/${slug}`);
export const ogJuego = (slug: string) => ogUrl(`juego/${slug}`);
