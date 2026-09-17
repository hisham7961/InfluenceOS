import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W1-3 / SEC-03 — the access token is bound to a live session + active user.
 * Revoking the session, deactivating the account, or demoting the role must
 * take effect on the NEXT request, not linger until the 15-minute token expiry.
 */
describe('SEC-03 — access token bound to session/user state', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function prisma() {
    const { PrismaClient } = await import('@influenceos/database');
    return new PrismaClient();
  }

  it('revoking the session → the same access token is rejected (401)', async () => {
    const { auth, userId } = await loginFresh(app);
    const before = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth });
    expect(before.statusCode).toBe(200);

    const db = await prisma();
    await db.deviceSession.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
    await db.$disconnect();

    const after = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth });
    expect(after.statusCode).toBe(401);
    await deleteUser(userId);
  });

  it('deactivating the user → the access token is rejected (401)', async () => {
    const { auth, userId } = await loginFresh(app);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth })).statusCode).toBe(200);

    const db = await prisma();
    await db.user.update({ where: { id: userId }, data: { isActive: false } });
    await db.$disconnect();

    const after = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth });
    expect(after.statusCode).toBe(401);
    await deleteUser(userId);
  });

  it('demoting ADMIN→STAFF → admin endpoints refuse the same token (403)', async () => {
    const { auth, userId } = await loginFresh(app); // fresh user is ADMIN
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth })).statusCode).toBe(200);

    const db = await prisma();
    await db.user.update({ where: { id: userId }, data: { role: 'STAFF' } });
    await db.$disconnect();

    // Role is read fresh from the DB in authenticate(), so the stale ADMIN
    // claim in the token no longer grants admin access.
    const after = await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth });
    expect(after.statusCode).toBe(403);
    // A non-admin endpoint still works (token itself is still valid).
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth })).statusCode).toBe(200);
    await deleteUser(userId);
  });
});
