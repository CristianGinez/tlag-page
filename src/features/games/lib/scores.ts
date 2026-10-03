import type { GameBoard, ScoreSubmission } from '../types';

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

const MAX_BOARD_S = 2147483;

/** Valida y normaliza la configuración de tablas de un juego; `null` si es inválida. */
export function validateBoards(x: unknown): GameBoard[] | null {
  if (!Array.isArray(x) || x.length > 10) return null;
  const seen = new Set<string>();
  const out: GameBoard[] = [];
  for (const b of x) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    const { id, label, min_s, max_s } = b as Record<string, unknown>;
    if (typeof id !== 'string' || !BOARD_RE.test(id) || seen.has(id)) return null;
    if (typeof label !== 'string' || !label.trim() || label.length > 40) return null;
    if (!Number.isInteger(min_s) || !Number.isInteger(max_s)) return null;
    const lo = min_s as number, hi = max_s as number;
    if (lo < 1 || lo >= hi || hi > MAX_BOARD_S) return null;
    seen.add(id);
    out.push({ id, label, min_s: lo, max_s: hi });
  }
  return out;
}
