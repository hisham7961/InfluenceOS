/**
 * A small in-process fixed-window counter for a second limit on one route
 * (@fastify/rate-limit applies only one limiter per request). The API runs as
 * a single process, so in-memory is enough; entries expire with their window.
 */
export function fixedWindowLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return async (key: string): Promise<void> => {
    const now = Date.now();
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
    }
    let w = windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      windows.set(key, w);
    }
    w.count += 1;
    if (w.count > max) {
      const err = new Error('Too many sign-in attempts. Please wait a minute and try again.') as Error & {
        statusCode?: number;
        code?: string;
      };
      err.statusCode = 429;
      err.code = 'RATE_LIMITED';
      throw err;
    }
  };
}
