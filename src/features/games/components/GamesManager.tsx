import { useEffect, useState } from 'react';
import { supabase } from '@/features/auth/lib/supabase';
import type { Game } from '../types';
import { GamePlayer } from './GamePlayer';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }
    : { 'Content-Type': 'application/json' };
}

type Draft = Partial<Game> & { slug: string; title: string };

const EMPTY: Draft = {
  slug: '', title: '', tagline: '', description: '', cover_url: '', controls: '', tags: [],
  play_url: '', version: 1, orientation: 'any', status: 'draft', display_order: 99,
  save_prefix: '', save_exclude: [],
};

const input = 'w-full bg-black border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:border-white/40 outline-none';
const lbl = 'block text-xs text-gray-400 font-mono mb-1 uppercase tracking-wider';

export function GamesManager() {
  const [games, setGames] = useState<Game[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch('/api/admin/games', { headers: await authHeaders() });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Error'); return; }
    setGames(data.games);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    setSaving(true); setError(null);
    const url = isNew ? '/api/admin/games' : `/api/admin/games?slug=${encodeURIComponent(editing.slug)}`;
    const res = await fetch(url, { method: isNew ? 'POST' : 'PATCH', headers: await authHeaders(), body: JSON.stringify(editing) });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? 'Error al guardar'); return; }
    setEditing(null);
    await load();
  }

  async function bumpVersion(game: Game) {
    const res = await fetch(`/api/admin/games?slug=${encodeURIComponent(game.slug)}`, {
      method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ version: game.version + 1 }),
    });
    if (res.ok) await load();
  }

  async function remove(game: Game) {
    if (!confirm(`¿Borrar "${game.title}" del catálogo? Los archivos en public/g/ no se tocan.`)) return;
    const res = await fetch(`/api/admin/games?slug=${encodeURIComponent(game.slug)}`, { method: 'DELETE', headers: await authHeaders() });
    if (res.ok) await load();
  }

  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, ...patch } : e));
  const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

  return (
    <div className="space-y-6">
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        onClick={() => { setEditing({ ...EMPTY }); setIsNew(true); }}
        className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded text-sm text-white cursor-pointer"
      >
        + Nuevo juego
      </button>

      <div className="space-y-3">
        {games.map((g) => (
          <div key={g.slug} className="flex flex-wrap items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/5">
            <div className="flex-1 min-w-[200px]">
              <p className="font-bold text-white">{g.title}</p>
              <p className="text-xs text-gray-500 font-mono">
                /{g.slug} · {g.status} · v{g.version} · {g.plays} partidas
              </p>
            </div>
            <GamePlayer game={g} preview label="Probar" />
            <button onClick={() => bumpVersion(g)} className="px-3 py-1.5 text-xs border border-white/20 rounded cursor-pointer">+ Versión</button>
            <button onClick={() => { setEditing({ ...g }); setIsNew(false); }} className="px-3 py-1.5 text-xs border border-white/20 rounded cursor-pointer">Editar</button>
            <button onClick={() => remove(g)} className="px-3 py-1.5 text-xs border border-red-500/40 text-red-400 rounded cursor-pointer">Borrar</button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="p-6 rounded-xl border border-white/10 bg-black/60 space-y-4">
          <h2 className="font-orbitron text-white">{isNew ? 'Nuevo juego' : `Editar ${editing.slug}`}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className={lbl}>Slug</label><input className={input} value={editing.slug} disabled={!isNew} onChange={(e) => set({ slug: e.target.value })} /></div>
            <div><label className={lbl}>Título</label><input className={input} value={editing.title} onChange={(e) => set({ title: e.target.value })} /></div>
            <div><label className={lbl}>Tagline</label><input className={input} value={editing.tagline ?? ''} onChange={(e) => set({ tagline: e.target.value })} /></div>
            <div><label className={lbl}>Portada (URL)</label><input className={input} value={editing.cover_url ?? ''} onChange={(e) => set({ cover_url: e.target.value })} /></div>
            <div className="md:col-span-2"><label className={lbl}>Descripción</label><textarea rows={4} className={input} value={editing.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></div>
            <div className="md:col-span-2"><label className={lbl}>Controles</label><textarea rows={2} className={input} value={editing.controls ?? ''} onChange={(e) => set({ controls: e.target.value })} /></div>
            <div><label className={lbl}>Tags (coma)</label><input className={input} value={(editing.tags ?? []).join(', ')} onChange={(e) => set({ tags: list(e.target.value) })} /></div>
            <div><label className={lbl}>URL del juego (vacío = /g/slug/)</label><input className={input} value={editing.play_url ?? ''} onChange={(e) => set({ play_url: e.target.value })} /></div>
            <div><label className={lbl}>Orientación</label>
              <select className={input} value={editing.orientation} onChange={(e) => set({ orientation: e.target.value as Game['orientation'] })}>
                <option value="any">Cualquiera</option><option value="landscape">Horizontal</option>
              </select>
            </div>
            <div><label className={lbl}>Estado</label>
              <select className={input} value={editing.status} onChange={(e) => set({ status: e.target.value as Game['status'] })}>
                <option value="draft">Borrador</option><option value="published">Publicado</option><option value="hidden">Oculto</option>
              </select>
            </div>
            <div><label className={lbl}>Orden</label><input type="number" className={input} value={editing.display_order ?? 99} onChange={(e) => set({ display_order: Number(e.target.value) })} /></div>
            <div><label className={lbl}>Versión</label><input type="number" min={1} className={input} value={editing.version ?? 1} onChange={(e) => set({ version: Number(e.target.value) })} /></div>
            <div><label className={lbl}>Prefijo de guardado</label><input className={input} value={editing.save_prefix ?? ''} onChange={(e) => set({ save_prefix: e.target.value })} /></div>
            <div><label className={lbl}>Claves sin sincronizar (coma)</label><input className={input} value={(editing.save_exclude ?? []).join(', ')} onChange={(e) => set({ save_exclude: list(e.target.value) })} /></div>
          </div>
          <div className="flex gap-3">
            <button onClick={save} disabled={saving} className="px-5 py-2 bg-white text-black font-bold rounded cursor-pointer disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar'}</button>
            <button onClick={() => setEditing(null)} className="px-5 py-2 border border-white/20 rounded text-white cursor-pointer">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
