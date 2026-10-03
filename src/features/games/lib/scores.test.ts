import { describe, it, expect } from 'vitest';
import { formatTime, pendingKey, isSubmission, addPending, MAX_PENDING } from './scores';

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
