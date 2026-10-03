import type { APIRoute } from 'astro';
import { ImageResponse } from '@vercel/og';
import { getGame } from '@/features/games/lib/gamesData';
import { loadOrbitronFont } from '@/shared/lib/ogFonts';

export const prerender = false;

export const GET: APIRoute = async ({ params, site }) => {
  const game = params.slug ? await getGame(params.slug) : null;
  if (!game) return new Response('Not found', { status: 404 });

  const siteUrl = site?.toString() ?? 'https://www.tlag.online';
  const fontData = await loadOrbitronFont(siteUrl);

  return new ImageResponse(
    {
      type: 'div',
      props: {
        style: {
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          padding: '80px', color: 'white', fontFamily: 'Orbitron', gap: '16px',
          background: 'linear-gradient(135deg, #050505 0%, #2a0505 100%)',
        },
        children: [
          { type: 'div', props: { style: { fontSize: 22, letterSpacing: '0.4em', opacity: 0.6 }, children: 'JUEGOS TEAMLAG' } },
          { type: 'div', props: { style: { fontSize: 72, fontWeight: 900 }, children: game.title } },
          game.tagline
            ? { type: 'div', props: { style: { fontSize: 32, opacity: 0.8 }, children: game.tagline } }
            : { type: 'div', props: { children: '' } },
        ],
      },
    } as any,
    {
      width: 1200,
      height: 630,
      fonts: [{ name: 'Orbitron', data: fontData, style: 'normal', weight: 900 }],
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    },
  );
};
