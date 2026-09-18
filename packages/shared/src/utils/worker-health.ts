// Pure worker-health decision logic (no bullmq/ioredis/framework imports) so it
// is unit-testable and shared with any runtime. See apps/worker for the wiring.

export type WorkerMode = 'starting' | 'redis+bullmq' | 'inline-fallback' | (string & {});

/**
 * The worker is healthy only when it is running on Redis/BullMQ AND Redis is
 * currently reachable. `inline-fallback` (Redis was unavailable) is a degraded
 * mode: maintenance still runs inline, but the queue is gone, so /health reports
 * 503 so an orchestrator/monitor is alerted rather than believing all is well
 * (WK-03). A live Redis drop in redis mode also flips this to degraded.
 */
export function computeWorkerHealth(
  mode: WorkerMode,
  redisHealthy: boolean,
): { code: 200 | 503; status: 'ok' | 'degraded' } {
  const healthy = mode === 'redis+bullmq' && redisHealthy;
  return healthy ? { code: 200, status: 'ok' } : { code: 503, status: 'degraded' };
}

/**
 * A job is dead-lettered only once its retry attempts are exhausted — an early
 * attempt that BullMQ will still retry is not a terminal failure (WK-04).
 */
export function shouldDeadLetter(attemptsMade: number, maxAttempts: number): boolean {
  return attemptsMade >= Math.max(1, maxAttempts);
}
