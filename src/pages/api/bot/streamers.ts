import type { APIRoute } from 'astro';
import { ConvexHttpClient } from 'convex/browser';
import { requireBotAdmin, json } from '@/features/bot-admin/lib/botApiAuth';

export const prerender = false;

const CONVEX_URL = import.meta.env.PUBLIC_CONVEX_URL as string;

export const GET: APIRoute = async (context) => {
  const auth = await requireBotAdmin(context);
  if (!auth.ok) return auth.response;

  const convex = new ConvexHttpClient(CONVEX_URL);
  (convex as any).setAdminAuth(import.meta.env.CONVEX_DEPLOY_KEY);

  try {
    const result = await convex.query('streamers:list' as any, {});
    return json({ ok: true, result });
  } catch (err: any) {
    console.error('[api/bot/streamers GET]', err?.message ?? err);
    return json({ error: err.message ?? String(err) }, 500);
  }
};

export const POST: APIRoute = async (context) => {
  const auth = await requireBotAdmin(context);
  if (!auth.ok) return auth.response;

  const body = await context.request.json();
  const { action: actionName, ...args } = body;

  const convex = new ConvexHttpClient(CONVEX_URL);
  (convex as any).setAdminAuth(import.meta.env.CONVEX_DEPLOY_KEY);

  try {
    let result;
    switch (actionName) {
      case 'addTwitch':
        result = await convex.action('streamers:addTwitch' as any, args);
        break;
      case 'addYoutube':
        result = await convex.action('streamers:addYoutube' as any, args);
        break;
      case 'addKick':
        result = await convex.action('streamers:addKick' as any, args);
        break;
      case 'remove':
        result = await convex.action('streamers:remove' as any, args);
        break;
      case 'setEnabled':
        result = await convex.mutation('streamers:setEnabled' as any, args);
        break;
      case 'update':
        result = await convex.mutation('streamers:update' as any, args);
        break;
      default:
        return json({ error: 'Unknown action' }, 400);
    }
    return json({ ok: true, result });
  } catch (err: any) {
    console.error('[api/bot/streamers POST]', err?.message ?? err);
    return json({ error: err.message ?? String(err) }, 500);
  }
};
