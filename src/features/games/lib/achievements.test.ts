import { describe, it, expect } from 'vitest';
import { achievementBadge } from './achievements';

describe('achievementBadge', () => {
  it('mapea el logro del juego a su badge', () => {
    expect(achievementBadge('lima-infecta', 'archivo-completo')).toBe('lima-archivo-completo');
  });
  it('rechaza logros, juegos o ids que no están en la lista', () => {
    expect(achievementBadge('lima-infecta', 'otro')).toBeNull();
    expect(achievementBadge('otro-juego', 'archivo-completo')).toBeNull();
    expect(achievementBadge('lima-infecta', 'constructor')).toBeNull();
    expect(achievementBadge('lima-infecta', 'toString')).toBeNull();
    expect(achievementBadge('lima-infecta', 42)).toBeNull();
  });
});
