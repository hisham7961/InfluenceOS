import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

function refresh(app: FastifyInstance, refreshToken: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
}

describe('auth — rotating refresh tokens with reuse detection', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rotates the refresh token on every use (single-use)', async () => {
    const { tokens, userId } = await loginFresh(app);
    const r1 = await refresh(app, tokens.refreshToken);
    expect(r1.statusCode).toBe(200);
    const next = (r1.json() as { tokens: Tokens }).tokens;
    // A brand-new refresh token is issued...
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    // ...and the new access token works.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${next.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    await deleteUser(userId);
  });

  it('detects reuse of a rotated token and revokes the whole session family', async () => {
    const { tokens, userId } = await loginFresh(app);

    // Rotate twice so the original token is well past the grace window.
    const r1 = await refresh(app, tokens.refreshToken);
    const t1 = (r1.json() as { tokens: Tokens }).tokens;
    const r2 = await refresh(app, t1.refreshToken);
    expect(r2.statusCode).toBe(200);
    const t2 = (r2.json() as { tokens: Tokens }).tokens;

    // Replay the ORIGINAL (long-since rotated) token → reuse → family revoke.
    const reuse = await refresh(app, tokens.refreshToken);
    expect(reuse.statusCode).toBe(401);

    // The latest legitimate token is now also dead (whole family revoked).
    const after = await refresh(app, t2.refreshToken);
    expect(after.statusCode).toBe(401);

    await deleteUser(userId);
  });

  it('rejects a syntactically valid but unknown/forged refresh token', async () => {
    const { userId } = await loginFresh(app);
    const bad = await refresh(app, 'not-a-real-token');
    expect(bad.statusCode).toBe(401);
    await deleteUser(userId);
  });

  it('invalidates the session on logout', async () => {
    const { tokens, userId } = await loginFresh(app);
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(out.statusCode).toBeLessThan(300);
    const dead = await refresh(app, tokens.refreshToken);
    expect(dead.statusCode).toBe(401);
    await deleteUser(userId);
  });

  it('accepts a genuinely concurrent refresh within the grace window', async () => {
    const { tokens, userId } = await loginFresh(app);
    // Two requests fire with the SAME token before either has completed.
    const [a, b] = await Promise.all([refresh(app, tokens.refreshToken), refresh(app, tokens.refreshToken)]);
    // Both succeed — the grace window absorbs the race; neither is treated as theft.
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 200]);
    await deleteUser(userId);
  });
});
