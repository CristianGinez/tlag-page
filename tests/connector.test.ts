import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-ignore -- sin @types/node en el proyecto; vitest lo resuelve
import { readFileSync } from 'node:fs';

const code = readFileSync('public/g/_tl/connect.js', 'utf8');
new Function(code)();
const create = (globalThis as any).__tlCreateConnector as (o: any) => any;

class FakeStorage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

const SITE = 'https://www.tlag.online';
let clock = 1000;

function setup(initial: Record<string, string> = {}) {
  class S extends FakeStorage {}
  const storage = new S();
  for (const [k, v] of Object.entries(initial)) storage.m.set(k, v);
  const parent = { postMessage: vi.fn() };
  const c = create({
    storage, proto: S.prototype, parent, game: 'lima', prefix: 'tl_lima_',
    parents: [SITE, 'http://localhost:4321'], now: () => clock,
  });
  const init = (saves: Record<string, { value: string; at: number }>, origin = SITE, source: unknown = parent) =>
    c._onMessage({ origin, source, data: { tl: 1, type: 'init', saves, user: { name: 'Lag' } } });
  const sent = (type: string) => parent.postMessage.mock.calls.map((a) => a[0]).filter((m) => m.type === type);
  return { storage, parent, c, init, sent };
}

beforeEach(() => { vi.useFakeTimers(); clock = 1000; });
afterEach(() => { vi.useRealTimers(); });

describe('connector', () => {
  it('envía hello a cada origen permitido con la meta local', () => {
    const { parent } = setup();
    expect(parent.postMessage).toHaveBeenCalledTimes(2); // antes de que corra ningún temporizador
    expect(parent.postMessage.mock.calls[0][1]).toBe(SITE);
    expect(parent.postMessage.mock.calls[0][0]).toMatchObject({ tl: 1, type: 'hello', game: 'lima' });
  });

  it('repite hello cada 500 ms hasta recibir init', () => {
    const { parent, init } = setup();
    const hellos = () => parent.postMessage.mock.calls.filter((a) => a[0].type === 'hello').length;
    vi.advanceTimersByTime(500);
    expect(hellos()).toBe(4);
    init({});
    vi.advanceTimersByTime(2000);
    expect(hellos()).toBe(4);
  });

  it('init applies newer cloud value without re-enqueueing it', async () => {
    const { storage, init, sent, c } = setup();
    init({ tl_lima_slot_0: { value: 'nube', at: 500 } });
    await c.ready;
    expect(storage.getItem('tl_lima_slot_0')).toBe('nube');
    expect(JSON.parse(storage.getItem('__tl_meta:lima')!)).toEqual({ tl_lima_slot_0: 500 });
    vi.advanceTimersByTime(5000);
    expect(sent('save')).toHaveLength(0);
    expect(c.user).toEqual({ name: 'Lag' });
  });

  it('mantiene la local si es más nueva y la sube tras init', () => {
    const { storage, init, sent } = setup({
      tl_lima_slot_0: 'local',
      '__tl_meta:lima': JSON.stringify({ tl_lima_slot_0: 900 }),
    });
    init({ tl_lima_slot_0: { value: 'nube', at: 500 } });
    expect(storage.getItem('tl_lima_slot_0')).toBe('local');
    expect(sent('save')).toEqual([
      expect.objectContaining({ items: [{ key: 'tl_lima_slot_0', value: 'local', at: 900 }] }),
    ]);
  });

  it('legacy local save sin meta: se sube si la nube está vacía', () => {
    const { init, sent } = setup({ tl_lima_slot_1: 'vieja' });
    init({});
    expect(sent('save')[0].items).toEqual([{ key: 'tl_lima_slot_1', value: 'vieja', at: 1 }]);
  });

  it('legacy local save sin meta: gana la nube si existe', () => {
    const { storage, init, sent } = setup({ tl_lima_slot_1: 'vieja' });
    init({ tl_lima_slot_1: { value: 'nube', at: 50 } });
    expect(storage.getItem('tl_lima_slot_1')).toBe('nube');
    expect(sent('save')).toHaveLength(0);
  });

  it('setItem de una clave con prefijo se envía agrupado a los 2 s; otras claves no', () => {
    const { storage, init, sent } = setup();
    init({});
    clock = 2000;
    storage.setItem('tl_lima_slot_2', 'a');
    storage.setItem('tl_lima_slot_2', 'b');
    storage.setItem('otra', 'x');
    expect(sent('save')).toHaveLength(0);
    vi.advanceTimersByTime(2000);
    expect(sent('save')).toEqual([
      expect.objectContaining({ items: [{ key: 'tl_lima_slot_2', value: 'b', at: 2000 }] }),
    ]);
    expect(storage.getItem('otra')).toBe('x');
  });

  it('ignores init from unknown origin or another window; ready se resuelve a los 8 s', async () => {
    const { init, storage, c, parent } = setup();
    init({ tl_lima_slot_0: { value: 'malo', at: 999 } }, 'https://evil.example');
    init({ tl_lima_slot_0: { value: 'malo', at: 999 } }, SITE, {});
    expect(storage.getItem('tl_lima_slot_0')).toBeNull();
    let done = false;
    c.ready.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(7999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    c.event('score', { score: 1 });
    expect(parent.postMessage.mock.calls.filter((a) => a[0].type === 'event')).toHaveLength(0);
  });

  it('flush del padre envía el guardado pendiente al instante; de otro origen no hace nada', () => {
    const { storage, init, sent, c, parent } = setup();
    init({});
    clock = 2000;
    storage.setItem('tl_lima_slot_2', 'ultimo');
    const flushMsg = (origin: string, source: unknown = parent) =>
      c._onMessage({ origin, source, data: { tl: 1, type: 'flush' } });
    flushMsg('https://evil.example');
    flushMsg(SITE, {});
    expect(sent('save')).toHaveLength(0);
    flushMsg(SITE);
    expect(sent('save')).toEqual([
      expect.objectContaining({ items: [{ key: 'tl_lima_slot_2', value: 'ultimo', at: 2000 }] }),
    ]);
  });

  it('init tardío tras el plazo de 8 s: no pisa el almacenamiento, pero sube lo local más nuevo', async () => {
    const { storage, init, sent, c } = setup({
      tl_lima_slot_0: 'local',
      tl_lima_slot_1: 'local1',
      '__tl_meta:lima': JSON.stringify({ tl_lima_slot_0: 900, tl_lima_slot_1: 100 }),
    });
    await vi.advanceTimersByTimeAsync(8000);
    init({
      tl_lima_slot_0: { value: 'nube0', at: 500 },
      tl_lima_slot_1: { value: 'nube1', at: 700 },
      tl_lima_slot_2: { value: 'nube2', at: 300 },
    });
    expect(c.user).toEqual({ name: 'Lag' });
    expect(storage.getItem('tl_lima_slot_0')).toBe('local');
    expect(storage.getItem('tl_lima_slot_1')).toBe('local1');
    expect(storage.getItem('tl_lima_slot_2')).toBeNull();
    expect(sent('save')).toEqual([
      expect.objectContaining({ items: [{ key: 'tl_lima_slot_0', value: 'local', at: 900 }] }),
    ]);
  });

  it('event y exit se envían al origen del init', () => {
    const { init, parent, c } = setup();
    init({});
    c.event('completed');
    c.exit();
    const calls = parent.postMessage.mock.calls.filter((a) => a[0].type === 'event' || a[0].type === 'exit');
    expect(calls.map((a) => [a[0].type, a[1]])).toEqual([['event', SITE], ['exit', SITE]]);
  });
});
