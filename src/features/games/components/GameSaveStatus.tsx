import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { supabase } from '@/features/auth/lib/supabase';
import { $currentUser } from '@/features/auth/stores/authStore';
import type { CloudSave } from '../types';

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

function ago(iso: string): string {
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, secs] of steps) if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  return 'hace un momento';
}

async function call(method: string, url: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  return fetch(url, { method, headers: { Authorization: `Bearer ${session.access_token}` } });
}

export function GameSaveStatus({ slug }: { slug: string }) {
  const user = useStore($currentUser);
  const [saves, setSaves] = useState<Record<string, CloudSave> | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await call('GET', `/api/games/saves?game=${encodeURIComponent(slug)}`);
    if (res?.ok) setSaves((await res.json()).saves);
  }

  useEffect(() => { if (user) load(); else setSaves(null); }, [user, slug]);

  if (!user) {
    return (
      <div className="text-sm text-gray-400">
        <a href="/login" className="text-white underline">Inicia sesión</a> para guardar tu partida en la nube y seguir en cualquier dispositivo.
      </div>
    );
  }

  const entries = Object.values(saves ?? {});
  if (!saves) return null;
  if (entries.length === 0) return <p className="text-sm text-gray-500">Aún no tienes partida en la nube.</p>;

  const latest = entries.map((s) => s.updatedAt).sort().at(-1)!;
  const hasPrev = entries.some((s) => s.hasPrev);

  async function restore() {
    if (!confirm('¿Restaurar la versión anterior de tu partida en la nube?')) return;
    setBusy(true);
    try {
      await call('POST', `/api/games/saves?game=${encodeURIComponent(slug)}&action=restore`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function wipe() {
    if (!confirm('¿Borrar tu partida en la nube? Si vuelves a jugar en este navegador, el guardado local se volverá a subir.')) return;
    setBusy(true);
    try {
      await call('DELETE', `/api/games/saves?game=${encodeURIComponent(slug)}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <h2 className="font-orbitron text-sm tracking-widest text-gray-500">TU PARTIDA</h2>
      <p className="text-sm text-gray-300">☁ Guardado en la nube · {ago(latest)}</p>
      <div className="flex flex-wrap gap-2">
        {hasPrev && (
          <button disabled={busy} onClick={restore} className="px-3 py-1.5 text-xs border border-white/20 rounded text-white cursor-pointer disabled:opacity-50">
            Restaurar versión anterior
          </button>
        )}
        <button disabled={busy} onClick={wipe} className="px-3 py-1.5 text-xs border border-red-500/40 text-red-400 rounded cursor-pointer disabled:opacity-50">
          Borrar partida en la nube
        </button>
      </div>
    </div>
  );
}
