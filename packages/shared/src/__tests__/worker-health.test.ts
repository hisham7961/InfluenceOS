import { describe, expect, it } from 'vitest';
import { computeWorkerHealth, shouldDeadLetter } from '../utils/worker-health';

/**
 * W2-1 (WK-03/04) — the worker's health verdict and dead-letter decision.
 * Health is 200 only on Redis/BullMQ with Redis reachable; every degraded state
 * is 503 so monitoring is alerted. A job is dead-lettered only after its retries
 * are exhausted.
 */
describe('worker health / dead-letter decisions', () => {
  it('is healthy (200/ok) only when on redis+bullmq AND Redis is reachable', () => {
    expect(computeWorkerHealth('redis+bullmq', true)).toEqual({ code: 200, status: 'ok' });
  });

  it('is degraded (503) when Redis is unreachable, in fallback, or still starting', () => {
    expect(computeWorkerHealth('redis+bullmq', false)).toEqual({ code: 503, status: 'degraded' });
    expect(computeWorkerHealth('inline-fallback', false)).toEqual({ code: 503, status: 'degraded' });
    expect(computeWorkerHealth('inline-fallback', true)).toEqual({ code: 503, status: 'degraded' });
    expect(computeWorkerHealth('starting', false)).toEqual({ code: 503, status: 'degraded' });
  });

  it('dead-letters a job only once its retry attempts are exhausted', () => {
    expect(shouldDeadLetter(1, 3)).toBe(false); // first attempt, 2 retries left
    expect(shouldDeadLetter(2, 3)).toBe(false);
    expect(shouldDeadLetter(3, 3)).toBe(true); // exhausted
    expect(shouldDeadLetter(1, 1)).toBe(true); // no retries configured
    expect(shouldDeadLetter(0, 0)).toBe(false); // guards the degenerate case
  });
});
