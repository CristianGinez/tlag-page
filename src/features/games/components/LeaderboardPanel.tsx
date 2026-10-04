import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { supabase } from '@/features/auth/lib/supabase';
import { $currentUser } from '@/features/auth/stores/authStore';
import type { GameBoard, MyScores, ScoreRow } from '../types';
import { formatTime } from '../lib/scores';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export function LeaderboardPanel({ slug, boards }: { slug: string; boards: GameBoard[] }) {
  const user = useStore($currentUser);
  const [board, setBoard] = useState(boards.find((b) => b.id === 'normal')?.id ?? boards[0]?.id);
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [mine, setMine] = useState<MyScores | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!board) return;
    let alive = true;
    setRows(null); setError(false);
    (async () => {
      try {
        const res = await fetch(`/api/games/scores?game=${encodeURIComponent(slug)}&board=${board}`, { headers: await authHeaders() });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        if (alive) setRows(body.rows ?? []);
      } catch { if (alive) setError(true); }
    })();
    return () => { alive = false; };
  }, [slug, board, user]);

  useEffect(() => {
    if (!user) { setMine(null); return; }
    let alive = true;
    (async () => {
      const res = await fetch(`/api/games/scores/me?game=${encodeURIComponent(slug)}`, { headers: await authHeaders() });
      if (res.ok && alive) setMine(await res.json());
    })().catch(() => {});
    return () => { alive = false; };
  }, [slug, user]);

  if (!boards.length) return null;
  const myBest = board ? mine?.boards?.[board] : undefined;

  return (
    <section className="mt-12">
      <h2 className="font-orbitron text-sm tracking-widest text-gray-500 mb-4">MARCADORES</h2>
      <div className="flex gap-2 mb-4">
        {boards.map((b) => (
          <button
            key={b.id}
            onClick={() => setBoard(b.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-bold cursor-pointer border ${b.id === board ? 'bg-red-600 border-red-600 text-white' : 'border-white/15 text-gray-300 hover:bg-white/10'}`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {error && <p className="text-gray-500 text-sm">No se pudo cargar el marcador.</p>}
      {!error && rows === null && <p className="text-gray-500 text-sm">Cargando…</p>}
      {!error && rows?.length === 0 && <p className="text-gray-500 text-sm">Aún no hay marcas. ¡Sé el primero!</p>}
      {!error && rows && rows.length > 0 && (
        <ol className="divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden">
          {rows.map((r) => (
            <li key={r.pos} className={`flex items-center gap-3 px-4 py-2.5 ${r.is_me ? 'bg-red-600/15' : 'bg-white/[0.02]'}`}>
              <span className="w-8 font-orbitron text-gray-400">#{r.pos}</span>
              {r.avatar
                ? <img src={r.avatar} alt="" className="w-7 h-7 rounded-full object-cover" loading="lazy" />
                : <span className="w-7 h-7 rounded-full bg-white/10" />}
              <span className="flex-1 truncate text-white">{r.name}</span>
              <span className="font-mono text-white">{formatTime(r.time_ms)}</span>
              <span className="w-6 text-center font-bold text-yellow-400">{r.rank}</span>
            </li>
          ))}
        </ol>
      )}

      {user && myBest && !rows?.some((r) => r.is_me) && (
        <p className="mt-3 text-sm text-gray-300">Tu mejor: #{myBest.pos} · {formatTime(myBest.time_ms)} · {myBest.rank}</p>
      )}
      {!user && <p className="mt-3 text-sm text-gray-500"><a href="/login" className="text-white underline">Inicia sesión</a> para aparecer en el marcador.</p>}
    </section>
  );
}
