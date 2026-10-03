import { useEffect, useRef, useState, type RefObject } from 'react';
import { supabase } from '@/features/auth/lib/supabase';
import type { CloudSave, PlayerGame, SaveItem } from '../types';
import { filterSyncable, mergeItems } from '../lib/saveSync';
import { getPlayOrigin } from '../lib/playUrl';

export type SyncStatus = 'idle' | 'saved' | 'offline' | 'login';

interface InitData {
  saves: Record<string, { value: string; at: number }>;
  user: { name: string } | null;
}

const RETRY_DELAYS = [5_000, 15_000, 60_000];

async function accessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/** Sesión + partidas de la nube. Se precarga al montar para que `init` responda rápido. */
async function loadInit(game: PlayerGame, preview: boolean): Promise<InitData> {
  const { data: { session } } = await supabase.auth.getSession();
  const meta = session?.user?.user_metadata ?? {};
  const user = session ? { name: String(meta.full_name ?? meta.name ?? 'Jugador') } : null;
  const saves: InitData['saves'] = {};
  if (session && game.save_prefix && !preview) {
    try {
      const res = await fetch(`/api/games/saves?game=${encodeURIComponent(game.slug)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { saves: Record<string, CloudSave> };
        for (const [k, s] of Object.entries(body.saves)) saves[k] = { value: s.value, at: s.at };
      }
    } catch { /* sin red: el juego arranca con lo local */ }
  }
  return { saves, user };
}

export function useGameBridge(opts: {
  open: boolean;
  iframe: RefObject<HTMLIFrameElement | null>;
  game: PlayerGame;
  /** true en el admin (Probar): no lee ni sube partidas; los borradores no admiten guardado. */
  preview?: boolean;
  onExit: () => void;
}): SyncStatus {
  const { open, iframe, game, preview = false, onExit } = opts;
  const [status, setStatus] = useState<SyncStatus>('idle');
  const prefetch = useRef<Promise<InitData> | null>(null);

  // Precarga al montar (y de nuevo tras cerrar, para no reutilizar datos viejos)
  useEffect(() => {
    if (!open) prefetch.current = loadInit(game, preview);
  }, [open, game.slug, preview]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let loginHinted = false;
    let retry = 0;
    let retryTimer: number | undefined;
    let pending: SaveItem[] = [];
    const gameOrigin = getPlayOrigin(game);
    const canSave = Boolean(game.save_prefix) && !preview;
    const initData = prefetch.current ?? loadInit(game, preview);

    const reply = (msg: Record<string, unknown>) =>
      iframe.current?.contentWindow?.postMessage({ tl: 1, game: game.slug, ...msg }, gameOrigin);

    async function upload(items: SaveItem[]) {
      const syncable = filterSyncable(items, game.save_prefix, game.save_exclude ?? []);
      if (!syncable.length || cancelled) return;
      const token = await accessToken();
      if (!token) {
        if (!loginHinted) { loginHinted = true; setStatus('login'); }
        return;
      }
      try {
        const res = await fetch('/api/games/saves', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ game: game.slug, items: syncable }),
        });
        if (!res.ok) throw new Error(String(res.status));
        retry = 0;
        if (!cancelled) setStatus('saved');
        reply({ type: 'saved', keys: syncable.map((i) => i.key) });
      } catch {
        if (cancelled) return;
        setStatus('offline');
        pending = mergeItems(pending, syncable);
        if (retry < RETRY_DELAYS.length) {
          window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(() => {
            const again = pending;
            pending = [];
            upload(again);
          }, RETRY_DELAYS[retry++]);
        }
      }
    }

    let initSent = false;
    async function onMessage(e: MessageEvent) {
      if (e.origin !== gameOrigin || !iframe.current || e.source !== iframe.current.contentWindow) return;
      const d = e.data;
      if (!d || d.tl !== 1) return;
      if (d.type === 'hello') {
        if (initSent) return; // el conector repite hello hasta recibir init
        initSent = true;
        const { saves, user } = await initData;
        if (!cancelled) reply({ type: 'init', saves, user });
      } else if (d.type === 'save' && canSave) {
        upload(Array.isArray(d.items) ? d.items : []);
      } else if (d.type === 'exit') {
        onExit();
      }
    }

    window.addEventListener('message', onMessage);
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener('message', onMessage);
      setStatus('idle');
    };
  }, [open, game.slug, preview]);

  // "Guardado" desaparece a los 2 s
  useEffect(() => {
    if (status !== 'saved') return;
    const t = window.setTimeout(() => setStatus('idle'), 2000);
    return () => window.clearTimeout(t);
  }, [status]);

  return status;
}
