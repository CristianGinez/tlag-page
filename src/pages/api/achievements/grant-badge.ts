import type { APIRoute } from 'astro';
import { getSupabase, createServiceClient } from '@/features/auth/lib/supabase';
import { getBadges } from '@/features/achievements/lib/achievementsData';

// Badges que un usuario puede otorgarse a sí mismo (acciones verificadas en el cliente).
// El resto se otorga desde /api/admin/grant-badge o desde endpoints de dominio.
const SELF_GRANTABLE = new Set(['discord-conectado']);

export const POST: APIRoute = async (context) => {
  try {
    // 1. Verificar sesión — acepta Bearer token (PKCE) o cookies (SSR)
    const authHeader = context.request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    let user: import('@supabase/supabase-js').User | null = null;
    if (token) {
      const serviceSupabase = createServiceClient();
      const { data } = await serviceSupabase.auth.getUser(token);
      user = data.user;
    } else {
      const ssrSupabase = getSupabase(context);
      const { data } = await ssrSupabase.auth.getUser();
      user = data.user;
    }

    if (!user) {
      return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401 });
    }

    const body = await context.request.json() as { badge_slug: string; event_id?: string };
    const { badge_slug, event_id = null } = body;
    if (!badge_slug) {
      return new Response(JSON.stringify({ error: 'badge_slug requerido' }), { status: 400 });
    }

    if (!SELF_GRANTABLE.has(badge_slug)) {
      return new Response(JSON.stringify({ error: 'Badge no autoasignable' }), { status: 403 });
    }

    // 2. Otorgar badge con service_role (idempotente)
    const serviceSupabase = createServiceClient();
    const { error: grantError } = await serviceSupabase.rpc('grant_badge', {
      target_user_id: user.id,
      badge_slug,
      target_event_id: event_id,
    });

    if (grantError) {
      console.error('[grant-badge] RPC error:', grantError);
      return new Response(JSON.stringify({ error: grantError.message }), { status: 500 });
    }

    // 3. Devolver el badge actualizado para que el cliente muestre el toast
    const badges = await getBadges(user.id);
    const badge = badges.find((b) => b.slug === badge_slug && b.unlocked) ?? null;

    return new Response(JSON.stringify({ ok: true, badge }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[grant-badge] unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Error interno' }), { status: 500 });
  }
};
