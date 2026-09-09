import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/** Mobile/web HTTP caching: ETag + conditional 304 on reads, no-store on auth. */
describe('caching — ETag, conditional requests & Cache-Control', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;

  beforeAll(async () => {
    app = await makeApp();
    const s = await loginFresh(app);
    auth = s.auth;
    userId = s.userId;
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(userId);
  });

  it('returns an ETag and serves 304 on a matching conditional request', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/v1/integrations', headers: auth });
    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();
    expect(first.headers['cache-control']).toContain('no-cache');

    const second = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { ...auth, 'if-none-match': etag as string },
    });
    expect(second.statusCode).toBe(304);
  });

  it('marks reads as private and never public', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/platform/features', headers: auth });
    expect(res.statusCode).toBe(200);
    const cc = res.headers['cache-control'] ?? '';
    expect(cc).toContain('private');
    expect(cc).not.toContain('public');
  });

  it('never caches auth responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
  });
});
