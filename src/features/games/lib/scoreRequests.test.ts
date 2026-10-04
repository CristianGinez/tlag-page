import { describe, it, expect, vi } from 'vitest';
import { handleGameRequest, flushPending, type RequestDeps } from './scoreRequests';

function deps(over: Partial<RequestDeps> = {}, responses: Array<[number, unknown]> = []) {
  let store: unknown = [];
  const calls: Array<[string, RequestInit | undefined]> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const [status, body] = responses.shift() ?? [200, {}];
    return new Response(JSON.stringify(body), { status });
  });
  const d: RequestDeps = {
    slug: 'lima-infecta', preview: false,
    getToken: async () => 'tok',
    fetch: fetchMock as unknown as typeof fetch,
    loadPending: () => store,
    savePending: (l) => { store = l; },
    ...over,
  };
  return { d, calls, get store() { return store; } };
}
const sub = { board: 'normal', time_ms: 700_000, rank: 'A', stats: { kills: 3 } };

describe('handleGameRequest', () => {
  it('leaderboard: pide el top y quita campos privados', async () => {
    const t = deps({}, [[200, { rows: [{ pos: 1, name: 'Lag', avatar: 'x', time_ms: 700000, rank: 'A', created_at: 'c', is_me: true }] }]]);
    const r = await handleGameRequest('leaderboard', { board: 'normal' }, t.d);
    expect(r).toEqual({ ok: true, data: { rows: [{ pos: 1, name: 'Lag', time_ms: 700000, rank: 'A', me: true }] } });
    expect(t.calls[0][0]).toBe('/api/games/scores?game=lima-infecta&board=normal');
  });
  it('bad_params sin llamar a la API', async () => {
    const t = deps();
    expect(await handleGameRequest('leaderboard', { board: '../x' }, t.d)).toEqual({ ok: false, error: 'bad_params' });
    expect(await handleGameRequest('submitScore', { ...sub, time_ms: 'x' }, t.d)).toEqual({ ok: false, error: 'bad_params' });
    expect(t.calls).toHaveLength(0);
  });
  it('unknown_request', async () => {
    expect(await handleGameRequest('borrarTodo', {}, deps().d)).toEqual({ ok: false, error: 'unknown_request' });
  });
  it('myScores sin sesión → login', async () => {
    expect(await handleGameRequest('myScores', null, deps({ getToken: async () => null }).d)).toEqual({ ok: true, data: { login: true } });
  });
  it('submitScore publicado', async () => {
    const t = deps({}, [[200, { status: 'published', pos: 3 }]]);
    expect(await handleGameRequest('submitScore', sub, t.d)).toEqual({ ok: true, data: { status: 'published', pos: 3 } });
    expect(t.calls[0][1]?.method).toBe('POST');
  });
  it('submitScore sin sesión → pendiente', async () => {
    const t = deps({ getToken: async () => null });
    expect(await handleGameRequest('submitScore', sub, t.d)).toEqual({ ok: true, data: { status: 'pending_login' } });
    expect(t.store).toEqual([sub]);
  });
  it('submitScore rechazado por la API (400)', async () => {
    const t = deps({}, [[400, { error: 'time_out_of_range' }]]);
    expect(await handleGameRequest('submitScore', sub, t.d)).toEqual({ ok: true, data: { status: 'rejected', reason: 'time_out_of_range' } });
  });
  it('submitScore con error de red → queda pendiente y devuelve error', async () => {
    const t = deps({ fetch: (async () => { throw new TypeError('net'); }) as unknown as typeof fetch });
    expect(await handleGameRequest('submitScore', sub, t.d)).toEqual({ ok: false, error: 'offline' });
    expect(t.store).toEqual([sub]);
  });
  it('preview no publica', async () => {
    const t = deps({ preview: true });
    expect(await handleGameRequest('submitScore', sub, t.d)).toEqual({ ok: true, data: { status: 'rejected', reason: 'preview' } });
    expect(t.calls).toHaveLength(0);
  });
});

describe('flushPending', () => {
  it('publica pendientes; quita 2xx y 400, conserva 5xx', async () => {
    const a = { ...sub, time_ms: 600_000 }, b = { ...sub, time_ms: 650_000 }, c = { ...sub, time_ms: 660_000 };
    const t = deps({}, [[200, {}], [400, {}], [500, {}]]);
    t.d.savePending([a, b, c]);
    await flushPending(t.d);
    expect(t.store).toEqual([c]);
  });
  it('sin sesión no hace nada', async () => {
    const t = deps({ getToken: async () => null });
    t.d.savePending([sub]);
    await flushPending(t.d);
    expect(t.calls).toHaveLength(0);
    expect(t.store).toEqual([sub]);
  });
  it('una marca añadida durante el vaciado sobrevive', async () => {
    const a = { ...sub, time_ms: 600_000 }, extra = { ...sub, time_ms: 777_000 };
    const t = deps();
    t.d.savePending([a]);
    const base = t.d.fetch;
    t.d.fetch = (async (...args: Parameters<typeof fetch>) => {
      t.d.savePending([...(t.d.loadPending() as typeof a[]), extra]);
      return base(...args);
    }) as typeof fetch;
    await flushPending(t.d);
    expect(t.store).toEqual([extra]);
  });
  it('dos vaciados simultáneos publican cada marca una sola vez', async () => {
    const t = deps();
    t.d.savePending([{ ...sub, time_ms: 600_000 }, { ...sub, time_ms: 650_000 }]);
    await Promise.all([flushPending(t.d), flushPending(t.d)]);
    expect(t.calls).toHaveLength(2);
    expect(t.store).toEqual([]);
  });
  it('getToken que rechaza no hace rechazar flushPending', async () => {
    const t = deps({ getToken: async () => { throw new Error('x'); } });
    await expect(flushPending(t.d)).resolves.toBeUndefined();
  });
});
