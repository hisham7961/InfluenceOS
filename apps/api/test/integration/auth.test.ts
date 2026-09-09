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
function tokensOf(res: Awaited<ReturnType<typeof refresh>>): Tokens {
  return (res.json() as { tokens: Tokens }).tokens;
}
function me(app: FastifyInstance, accessToken: string) {
  return app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${accessToken}` } });
}

describe('auth — atomic rotating refresh tokens', () => {
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
    const next = tokensOf(r1);
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    expect((await me(app, next.accessToken)).statusCode).toBe(200);
    await deleteUser(userId);
  });

  it('detects reuse of a rotated token and revokes the whole session family', async () => {
    const { tokens, userId } = await loginFresh(app);
    const t1 = tokensOf(await refresh(app, tokens.refreshToken));
    const t2 = tokensOf(await refresh(app, t1.refreshToken)); // original now well past current/prev

    const reuse = await refresh(app, tokens.refreshToken);
    expect(reuse.statusCode).toBe(401);
    // Whole family revoked — the latest legitimate token is dead too.
    expect((await refresh(app, t2.refreshToken)).statusCode).toBe(401);
    await deleteUser(userId);
  });

  it('rejects a forged/unknown refresh token without touching the session', async () => {
    const { tokens, userId } = await loginFresh(app);
    expect((await refresh(app, 'not-a-real-token')).statusCode).toBe(401);
    // The real session is untouched by a garbage token.
    expect((await refresh(app, tokens.refreshToken)).statusCode).toBe(200);
    await deleteUser(userId);
  });

  it('invalidates the session on logout', async () => {
    const { tokens, userId } = await loginFresh(app);
    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', payload: { refreshToken: tokens.refreshToken } });
    expect(out.statusCode).toBeLessThan(300);
    expect((await refresh(app, tokens.refreshToken)).statusCode).toBe(401);
    await deleteUser(userId);
  });

  // --- Concurrency: the core of the hardening fix -------------------------

  it('is deterministic under two simultaneous refreshes of the same token', async () => {
    const { tokens, userId } = await loginFresh(app);

    // Fire BOTH refreshes with T0 before either completes.
    const [a, b] = await Promise.all([refresh(app, tokens.refreshToken), refresh(app, tokens.refreshToken)]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);

    const ta = tokensOf(a);
    const tb = tokensOf(b);
    // Deterministic: both callers converge on the SAME rotated refresh token
    // (idempotent), so the lineage can never diverge into two "current" tokens.
    expect(ta.refreshToken).toBe(tb.refreshToken);

    // Both returned access tokens are valid.
    expect((await me(app, ta.accessToken)).statusCode).toBe(200);
    expect((await me(app, tb.accessToken)).statusCode).toBe(200);

    // The single returned refresh token is live and does NOT trigger revocation.
    const r2 = await refresh(app, ta.refreshToken);
    expect(r2.statusCode).toBe(200);
    await deleteUser(userId);
  });

  it('never lets a legitimately-returned concurrent token trigger family revocation', async () => {
    const { tokens, userId } = await loginFresh(app);
    const results = await Promise.all(Array.from({ length: 8 }, () => refresh(app, tokens.refreshToken)));
    // Every concurrent refresh of the same token succeeds...
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const refreshTokens = results.map((r) => tokensOf(r).refreshToken);
    // ...and all converge on one token (deterministic).
    expect(new Set(refreshTokens).size).toBe(1);

    // That token still works — no false reuse detection from the burst.
    const live = refreshTokens[0]!;
    expect((await refresh(app, live)).statusCode).toBe(200);
    await deleteUser(userId);
  });

  it('stress: many simultaneous refreshes keep exactly one live lineage', async () => {
    const { tokens, userId } = await loginFresh(app);
    const burst = await Promise.all(Array.from({ length: 20 }, () => refresh(app, tokens.refreshToken)));
    const ok = burst.filter((r) => r.statusCode === 200);
    // Under the row lock + idempotent grace return, every concurrent use of the
    // same token is accepted and returns the identical rotated token.
    expect(ok.length).toBe(20);
    expect(new Set(ok.map((r) => tokensOf(r).refreshToken)).size).toBe(1);
    // A genuinely retired token (the original, now rotated past grace by the
    // next real rotation) triggers reuse detection.
    const live = tokensOf(ok[0]!).refreshToken;
    tokensOf(await refresh(app, live)); // rotate once more so the original is retired
    expect((await refresh(app, tokens.refreshToken)).statusCode).toBe(401);
    await deleteUser(userId);
  });
});

describe('auth — change password', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
  });

  function changePassword(accessToken: string, body: unknown) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: body,
    });
  }

  it('requires the correct current password and revokes all sessions', async () => {
    const { tokens, email, password, userId } = await loginFresh(app);
    const newPassword = 'Rotated-Pass1';

    // Wrong current password → rejected.
    expect((await changePassword(tokens.accessToken, { currentPassword: 'wrong', newPassword })).statusCode).toBe(400);
    // Weak new password → validation error.
    expect((await changePassword(tokens.accessToken, { currentPassword: password, newPassword: 'weak' })).statusCode).toBe(422);

    // Correct change → 204.
    const ok = await changePassword(tokens.accessToken, { currentPassword: password, newPassword });
    expect(ok.statusCode).toBe(204);

    // Session policy: the old refresh token is now dead (all sessions revoked).
    expect((await refresh(app, tokens.refreshToken)).statusCode).toBe(401);

    // Old password no longer logs in; the new one does.
    const oldLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: newPassword } });
    expect(newLogin.statusCode).toBe(200);

    await deleteUser(userId);
  });

  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      payload: { currentPassword: 'x', newPassword: 'Rotated-Pass1' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('auth — account lockout (brute-force protection)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('locks the account after repeated failures and blocks even the correct password', async () => {
    // Provision a real user (loginFresh performs one successful login, which
    // resets the counter to a known-clean baseline).
    const { email, password, userId } = await loginFresh(app);

    const attempt = (pw: string) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: pw } });

    // LOGIN_MAX_ATTEMPTS (default 10) consecutive failures trip the lockout.
    let lastBody = '';
    for (let i = 0; i < 10; i++) {
      const res = await attempt('definitely-wrong');
      expect(res.statusCode).toBe(401);
      lastBody = res.body;
    }
    expect(lastBody).toContain('Invalid email or password');

    // Now the correct password is refused while the lock window is open, with a
    // distinct message — proving the block is account-level, not credential-level.
    const locked = await attempt(password);
    expect(locked.statusCode).toBe(401);
    expect(locked.body).toContain('Too many failed attempts');

    await deleteUser(userId);
  });
});
