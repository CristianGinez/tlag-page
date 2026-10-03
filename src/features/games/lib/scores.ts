import type { ScoreSubmission } from '../types';

export const BOARD_RE = /^[a-z0-9_-]{1,32}$/;
export const MAX_PENDING = 5;
const RANKS = ['S', 'A', 'B', 'C'];

export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export const pendingKey = (slug: string) => `tl_pending_scores:${slug}`;

export function isSubmission(x: unknown): x is ScoreSubmission {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.board === 'string' && BOARD_RE.test(o.board)
    && typeof o.time_ms === 'number' && Number.isFinite(o.time_ms) && o.time_ms > 0
    && typeof o.rank === 'string' && RANKS.includes(o.rank)
    && !!o.stats && typeof o.stats === 'object' && !Array.isArray(o.stats);
}

/** Añade una marca pendiente; descarta entradas inválidas y conserva las `max` más recientes. */
export function addPending(list: unknown, item: ScoreSubmission, max: number = MAX_PENDING): ScoreSubmission[] {
  const valid = Array.isArray(list) ? list.filter(isSubmission) : [];
  return [...valid, item].slice(-max);
}
