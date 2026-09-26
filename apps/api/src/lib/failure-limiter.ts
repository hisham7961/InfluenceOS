/**
 * A small in-process fixed-window counter of FAILED attempts, for limits that
 * @fastify/rate-limit can't express (it counts every request and applies only
 * one limiter per request). The API runs as a single process, so in-memory is
 * enough; entries expire with their window.
 *
 * `check` refuses once `max` failures are on record, `fail` records one, and
 * `clear` forgets them (a successful sign-in) — so someone who signs in often
 * never runs out, while repeated wrong guesses do.
 */
export function failureLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const windows = new Map<string, { count: number; resetAt: number }>();

  const current = (key: string, now: number) => {
    const w = windows.get(key);
    if (w && w.resetAt <= now) {
      windows.delete(key);
      return undefined;
    }
    return w;
  };

  return {
    check(key: string): void {
      const w = current(key, Date.now());
      if (w && w.count >= max) {
        const err = new Error('Too many sign-in attempts. Please wait a few minutes and try again.') as Error & {
          statusCode?: number;
          code?: string;
        };
        err.statusCode = 429;
        err.code = 'RATE_LIMITED';
        throw err;
      }
    },
    fail(key: string): void {
      const now = Date.now();
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
      }
      const w = current(key, now);
      if (w) w.count += 1;
      else windows.set(key, { count: 1, resetAt: now + windowMs });
    },
    clear(key: string): void {
      windows.delete(key);
    },
  };
}
