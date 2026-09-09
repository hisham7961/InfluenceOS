import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp } from '../helpers.ts';

/**
 * Production operational surface: liveness (/health), readiness (/ready), the
 * request-id correlation header, and the environment fail-fast contract. These
 * are the endpoints an orchestrator / reverse proxy depends on, so they are
 * covered like any other public contract.
 */
describe('operational endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health is 200 with release identity and never requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.service).toBe('influenceos-api');
    // Release identity is present (values may be defaults in dev) …
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('gitSha');
    expect(body).toHaveProperty('environment');
    expect(typeof body.uptimeSec).toBe('number');
    // … and it must NEVER leak secrets.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(process.env.AUTH_SECRET ?? '__no_secret__');
    expect(serialized.toLowerCase()).not.toContain('password');
  });

  it('GET /ready reports database reachability and is 200 when the DB is up', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    // The test DB is up, so readiness must be 200.
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; checks: Array<{ name: string; status: string }> };
    expect(body.status).toBe('ready');
    const db = body.checks.find((c) => c.name === 'database');
    expect(db?.status).toBe('ok');
  });

  it('echoes an inbound x-request-id and generates one when absent', async () => {
    const supplied = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'trace-abc-123' },
    });
    expect(supplied.headers['x-request-id']).toBe('trace-abc-123');

    const generated = await app.inject({ method: 'GET', url: '/health' });
    expect(String(generated.headers['x-request-id'] ?? '')).toMatch(/^req_/);
  });

  it('GET /metrics exposes Prometheus text with build info and request counters', async () => {
    // Generate at least one counted request first.
    await app.inject({ method: 'GET', url: '/health' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    const body = res.body;
    expect(body).toContain('influenceos_build_info');
    expect(body).toContain('influenceos_up');
    expect(body).toContain('influenceos_db_up');
    expect(body).toContain('influenceos_http_requests_total');
    expect(body).toContain('process_uptime_seconds');
    // No secret must ever appear in the exposition.
    expect(body).not.toContain(process.env.AUTH_SECRET ?? '__no_secret__');
  });

  it('error responses carry the same requestId in the body and header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/does-not-exist',
      headers: { 'x-request-id': 'trace-err-9' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { requestId: string } };
    expect(body.error.requestId).toBe('trace-err-9');
    expect(res.headers['x-request-id']).toBe('trace-err-9');
  });
});

/**
 * Fail-fast environment contract (apps/api/src/env.ts). Validated directly so a
 * misconfiguration can never silently boot in production.
 */
describe('env contract', () => {
  it('accepts the current (valid) process environment', async () => {
    const { resetEnv, loadEnv } = await import('../../src/env.ts');
    resetEnv();
    const env = loadEnv();
    expect(env.DATABASE_URL).toBeTruthy();
    expect(env.AUTH_SECRET.length).toBeGreaterThanOrEqual(16);
    resetEnv();
  });

  it('rejects a production env with a weak/default AUTH_SECRET', async () => {
    // Parse the schema in isolation (no process.exit) to assert the prod rule.
    const { z } = await import('zod');
    // Re-declare the production invariant the schema enforces, exercised via a
    // direct safeParse of a cloned schema is impractical (schema is private), so
    // assert the observable rule: a 20-char "change-me…" secret is rejected in
    // production. We do this by temporarily swapping env and catching exit.
    const original = { NODE_ENV: process.env.NODE_ENV, AUTH_SECRET: process.env.AUTH_SECRET };
    const exit = process.exit;
    let exited = false;
    // @ts-expect-error test stub
    process.exit = ((code?: number) => {
      exited = true;
      throw new Error(`exit:${code}`);
    }) as never;
    try {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_SECRET = 'change-me-please-1234'; // contains "change-me"
      const { resetEnv, loadEnv } = await import('../../src/env.ts');
      resetEnv();
      expect(() => loadEnv()).toThrow(/exit:1/);
      expect(exited).toBe(true);
    } finally {
      process.exit = exit;
      process.env.NODE_ENV = original.NODE_ENV;
      if (original.AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = original.AUTH_SECRET;
      const { resetEnv } = await import('../../src/env.ts');
      resetEnv();
    }
    // Keep zod import referenced (schema mirror documentation).
    expect(typeof z.object).toBe('function');
  });
});
