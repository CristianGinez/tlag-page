import type { ScoreSubmission } from '../types';
import { BOARD_RE, addPending, isSubmission } from './scores';
import { ACHIEVEMENT_RE } from './achievements';

export interface RequestDeps {
  slug: string;
  preview: boolean;
  getToken(): Promise<string | null>;
  fetch: typeof fetch;
  loadPending(): unknown;
  savePending(list: ScoreSubmission[]): void;
}

export type RequestResult = { ok: true; data: unknown } | { ok: false; error: string };

const ok = (data: unknown): RequestResult => ({ ok: true, data });
const fail = (error: string): RequestResult => ({ ok: false, error });
const auth = (token: string | null): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

async function postScore(deps: RequestDeps, token: string, item: ScoreSubmission): Promise<Response> {
  return deps.fetch('/api/games/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ game: deps.slug, ...item }),
  });
}

/** Atiende un TL.request del juego. Nunca lanza: devuelve { ok, data | error }. */
export async function handleGameRequest(name: unknown, params: unknown, deps: RequestDeps): Promise<RequestResult> {
  const slug = encodeURIComponent(deps.slug);
  try {
    switch (name) {
      case 'leaderboard': {
        const board = (params as { board?: unknown } | null)?.board;
        if (typeof board !== 'string' || !BOARD_RE.test(board)) return fail('bad_params');
        const token = await deps.getToken();
        const res = await deps.fetch(`/api/games/scores?game=${slug}&board=${board}`, { headers: auth(token) });
        if (!res.ok) return fail(`http_${res.status}`);
        const body = (await res.json()) as { rows?: Array<Record<string, unknown>> };
        const rows = (body.rows ?? []).map((r) => ({
          pos: r.pos, name: r.name, time_ms: r.time_ms, rank: r.rank, me: r.is_me === true,
        }));
        return ok({ rows });
      }
      case 'myScores': {
        const token = await deps.getToken();
        if (!token) return ok({ login: true });
        const res = await deps.fetch(`/api/games/scores/me?game=${slug}`, { headers: auth(token) });
        if (res.status === 401) return ok({ login: true });
        if (!res.ok) return fail(`http_${res.status}`);
        return ok(await res.json());
      }
      case 'submitScore': {
        if (!isSubmission(params)) return fail('bad_params');
        const item: ScoreSubmission = { board: params.board, time_ms: Math.round(params.time_ms), rank: params.rank, stats: params.stats };
        if (deps.preview) return ok({ status: 'rejected', reason: 'preview' });
        const token = await deps.getToken();
        if (!token) {
          deps.savePending(addPending(deps.loadPending(), item));
          return ok({ status: 'pending_login' });
        }
        let res: Response;
        try {
          res = await postScore(deps, token, item);
        } catch {
          deps.savePending(addPending(deps.loadPending(), item));
          return fail('offline');
        }
        const body = (await res.json().catch(() => ({}))) as { pos?: number; error?: string };
        if (res.ok) return ok({ status: 'published', pos: body.pos ?? null });
        if (res.status === 400 || res.status === 404) return ok({ status: 'rejected', reason: body.error ?? 'rejected' });
        deps.savePending(addPending(deps.loadPending(), item));
        return fail(`http_${res.status}`);
      }
      case 'unlockAchievement': {
        // Sin cola de pendientes: el juego vuelve a pedirlo la próxima vez que se cumpla la condición
        const id = (params as { id?: unknown } | null)?.id;
        if (typeof id !== 'string' || !ACHIEVEMENT_RE.test(id)) return fail('bad_params');
        if (deps.preview) return ok({ status: 'rejected', reason: 'preview' });
        const token = await deps.getToken();
        if (!token) return ok({ status: 'pending_login' });
        const res = await deps.fetch('/api/games/achievement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth(token) },
          body: JSON.stringify({ game: deps.slug, id }),
        });
        const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string; badge?: unknown };
        if (res.ok) return ok({ status: body.status === 'granted' ? 'granted' : 'already', badge: body.badge ?? null });
        if (res.status === 401) return ok({ status: 'pending_login' });
        if (res.status === 404) return ok({ status: 'rejected', reason: body.error ?? 'rejected' });
        return fail(`http_${res.status}`);
      }
      default:
        return fail('unknown_request');
    }
  } catch {
    return fail('offline');
  }
}

const flushing = new Set<string>();
const keyOf = (i: ScoreSubmission) => `${i.board}|${i.time_ms}|${i.rank}|${JSON.stringify(i.stats)}`;

/** Publica las marcas pendientes. Quita las aceptadas (2xx) y las inválidas (400/404); conserva el resto. Nunca lanza. */
export async function flushPending(deps: RequestDeps): Promise<void> {
  if (deps.preview || flushing.has(deps.slug)) return;
  flushing.add(deps.slug);
  try {
    const token = await deps.getToken();
    if (!token) return;
    const read = () => (Array.isArray(deps.loadPending()) ? (deps.loadPending() as unknown[]).filter(isSubmission) : []);
    const list = read();
    if (!list.length) return;
    const done = new Set<string>();
    for (const item of list) {
      try {
        const res = await postScore(deps, token, item);
        if (res.ok || res.status === 400 || res.status === 404) done.add(keyOf(item));
      } catch { /* se conserva */ }
    }
    // Relee: puede haber marcas nuevas guardadas durante el vaciado
    deps.savePending(read().filter((i) => !done.has(keyOf(i))));
  } catch {
    /* nunca lanza */
  } finally {
    flushing.delete(deps.slug);
  }
}
