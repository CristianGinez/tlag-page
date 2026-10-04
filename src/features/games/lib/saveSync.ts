import type { SaveItem } from '../types';

const META_PREFIX = '__tl_meta';
const NEW_GAME_MS = 14 * 24 * 60 * 60 * 1000;

/** Filtra lo que el juego mandó: solo claves con prefijo, no excluidas y con forma válida. */
export function filterSyncable(items: unknown, prefix: string | null, exclude: string[]): SaveItem[] {
  if (!prefix || !Array.isArray(items)) return [];
  return items.filter((i): i is SaveItem =>
    !!i &&
    typeof i.key === 'string' &&
    typeof i.value === 'string' &&
    typeof i.at === 'number' &&
    Number.isFinite(i.at) &&
    i.key.startsWith(prefix) &&
    !i.key.startsWith(META_PREFIX) &&
    !exclude.includes(i.key),
  );
}

/** Une dos listas de cambios; por clave gana el `at` mayor. Conserva el orden de primera aparición. */
export function mergeItems(a: SaveItem[], b: SaveItem[]): SaveItem[] {
  const byKey = new Map<string, SaveItem>();
  for (const item of [...a, ...b]) {
    const prev = byKey.get(item.key);
    if (!prev || item.at > prev.at) byKey.set(item.key, item);
  }
  return [...byKey.values()];
}

export function isNewGame(publishedAt: string | null, now: number = Date.now()): boolean {
  if (!publishedAt) return false;
  const t = Date.parse(publishedAt);
  return Number.isFinite(t) && now - t < NEW_GAME_MS;
}
