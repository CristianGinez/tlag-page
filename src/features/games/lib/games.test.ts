import { describe, it, expect } from 'vitest';
import { getPlayUrl, getPlayOrigin } from './playUrl';
import { filterSyncable, mergeItems, isNewGame } from './saveSync';

const base = { slug: 'lima-infecta', play_url: null, version: 3 };

describe('getPlayUrl', () => {
  it('usa el origen de juegos y /g/<slug>/index.html cuando play_url es null', () => {
    expect(getPlayUrl(base, 'https://juegos.tlag.online')).toBe('https://juegos.tlag.online/g/lima-infecta/index.html?v=3');
  });
  it('quita la barra final del origen', () => {
    expect(getPlayUrl(base, 'http://127.0.0.1:4321/')).toBe('http://127.0.0.1:4321/g/lima-infecta/index.html?v=3');
  });
  it('respeta play_url y añade v con & si ya tiene query', () => {
    expect(getPlayUrl({ ...base, play_url: 'https://cdn.x.com/juego/?a=1' })).toBe('https://cdn.x.com/juego/?a=1&v=3');
  });
  it('getPlayOrigin devuelve solo el origen', () => {
    expect(getPlayOrigin({ ...base, play_url: 'https://cdn.x.com/juego/' })).toBe('https://cdn.x.com');
  });
});

describe('filterSyncable', () => {
  const items = [
    { key: 'tl_lima_slot_0', value: 'a', at: 10 },
    { key: 'tl_lima_settings', value: 'b', at: 10 },
    { key: 'otra_clave', value: 'c', at: 10 },
    { key: '__tl_meta:lima-infecta', value: '{}', at: 10 },
    { key: 'tl_lima_slot_1', value: 5, at: 10 },
    { key: 'tl_lima_slot_2', value: 'd', at: Number.NaN },
  ];
  it('deja solo claves con prefijo, no excluidas y bien formadas', () => {
    expect(filterSyncable(items, 'tl_lima_', ['tl_lima_settings'])).toEqual([{ key: 'tl_lima_slot_0', value: 'a', at: 10 }]);
  });
  it('sin prefijo no sincroniza nada', () => {
    expect(filterSyncable(items, null, [])).toEqual([]);
  });
  it('acepta entrada que no es array', () => {
    expect(filterSyncable('x', 'tl_', [])).toEqual([]);
  });
});

describe('mergeItems', () => {
  it('por clave gana el at mayor', () => {
    const a = [{ key: 'k', value: 'viejo', at: 1 }, { key: 'j', value: 'j1', at: 5 }];
    const b = [{ key: 'k', value: 'nuevo', at: 2 }];
    expect(mergeItems(a, b)).toEqual([{ key: 'k', value: 'nuevo', at: 2 }, { key: 'j', value: 'j1', at: 5 }]);
  });
});

describe('isNewGame', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  it('true si se publicó hace menos de 14 días', () => {
    expect(isNewGame('2026-10-10T00:00:00Z', now)).toBe(true);
  });
  it('false si hace más de 14 días o es null', () => {
    expect(isNewGame('2026-10-01T00:00:00Z', now)).toBe(false);
    expect(isNewGame(null, now)).toBe(false);
  });
});
