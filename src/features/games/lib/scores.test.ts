import { describe, it, expect } from 'vitest';
import { formatTime, pendingKey, isSubmission, addPending, MAX_PENDING, validateBoards } from './scores';

const sub = (t: number) => ({ board: 'normal', time_ms: t, rank: 'A', stats: {} });

describe('formatTime', () => {
  it('m:ss por debajo de una hora', () => { expect(formatTime(65_000)).toBe('1:05'); });
  it('h:mm:ss desde una hora', () => { expect(formatTime(3_725_999)).toBe('1:02:05'); });
  it('valores inválidos', () => { expect(formatTime(Number.NaN)).toBe('—'); expect(formatTime(-1)).toBe('—'); });
});

describe('pendientes', () => {
  it('clave por juego', () => { expect(pendingKey('lima-infecta')).toBe('tl_pending_scores:lima-infecta'); });
  it('isSubmission valida forma', () => {
    expect(isSubmission(sub(700_000))).toBe(true);
    expect(isSubmission({ ...sub(1), board: 'NO VALE' })).toBe(false);
    expect(isSubmission({ ...sub(1), time_ms: '5' })).toBe(false);
    expect(isSubmission({ ...sub(1), rank: 'Z' })).toBe(false);
    expect(isSubmission({ ...sub(1), stats: [] })).toBe(false);
    expect(isSubmission(null)).toBe(false);
  });
  it('addPending descarta basura y conserva los últimos MAX_PENDING', () => {
    let list: unknown = 'basura';
    for (let i = 1; i <= 7; i++) list = addPending(list, sub(i * 1000));
    const out = list as ReturnType<typeof addPending>;
    expect(out).toHaveLength(MAX_PENDING);
    expect(out[0].time_ms).toBe(3000);
    expect(out[4].time_ms).toBe(7000);
  });
});

describe('validateBoards', () => {
  const lima = [
    { id: 'facil', label: 'Fácil', min_s: 600, max_s: 36000 },
    { id: 'normal', label: 'Normal', min_s: 600, max_s: 36000 },
    { id: 'clasico', label: 'Clásico', min_s: 600, max_s: 36000 },
  ];
  const b = (o: object) => [{ ...lima[0], ...o }];
  it('tablas de Lima válidas', () => { expect(validateBoards(lima)).toEqual(lima); });
  it('[] → []', () => { expect(validateBoards([])).toEqual([]); });
  it('max_s 0 → null', () => { expect(validateBoards(b({ max_s: 0 }))).toBeNull(); });
  it('600.5 → null', () => { expect(validateBoards(b({ max_s: 600.5 }))).toBeNull(); });
  it('max_s 3000000 → null', () => { expect(validateBoards(b({ max_s: 3_000_000 }))).toBeNull(); });
  it('id duplicado → null', () => { expect(validateBoards([lima[0], lima[0]])).toBeNull(); });
  it('min_s >= max_s → null', () => { expect(validateBoards(b({ min_s: 36000 }))).toBeNull(); });
  it('no array → null', () => { expect(validateBoards({})).toBeNull(); expect(validateBoards(null)).toBeNull(); });
  it('id, label inválidos o más de 10 → null', () => {
    expect(validateBoards(b({ id: 'NO VALE' }))).toBeNull();
    expect(validateBoards(b({ label: '' }))).toBeNull();
    expect(validateBoards(b({ label: 'x'.repeat(41) }))).toBeNull();
    expect(validateBoards(Array.from({ length: 11 }, (_, i) => ({ ...lima[0], id: `b${i}` })))).toBeNull();
  });
  it('normaliza descartando campos extra', () => {
    expect(validateBoards(b({ extra: 1 }))).toEqual([lima[0]]);
  });
});
