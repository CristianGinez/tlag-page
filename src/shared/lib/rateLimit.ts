import { Ratelimit } from '@upstash/ratelimit';
import { redis } from './redis';

type Window = Parameters<typeof Ratelimit.slidingWindow>[1];
const limiters = new Map<string, Ratelimit>();

/** true si la petición está permitida. Si Redis no está disponible (dev), permite. */
export async function checkRateLimit(name: string, tokens: number, window: Window, id: string): Promise<boolean> {
  let limiter = limiters.get(name);
  if (!limiter) {
    limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(tokens, window), prefix: `rl:${name}` });
    limiters.set(name, limiter);
  }
  try {
    const { success } = await limiter.limit(id);
    return success;
  } catch (err) {
    console.warn(`[rateLimit] ${name} no disponible, se permite:`, err);
    return true;
  }
}
