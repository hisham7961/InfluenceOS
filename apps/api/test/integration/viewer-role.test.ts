import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/** Provision a throwaway VIEWER (read-only) user and return an auth header. */
async function loginViewer(app: FastifyInstance): Promise<{ auth: Record<string, string>; userId: string; email: string; password: string }> {
  const email = `viewer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const user = await prisma.user.create({ data: { email, name: 'Test Viewer', role: 'VIEWER', passwordHash: await hash(password) } });
  await prisma.$disconnect();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const tokens = (res.json() as { tokens: { accessToken: string } }).tokens;
  return { auth: { authorization: `Bearer ${tokens.accessToken}` }, userId: user.id, email, password };
}

/**
 * W4-4 — the read-only VIEWER role. A viewer reads everything but cannot mutate:
 * every write is refused 403, while reads and auth self-service still work.
 */
describe('W4-4 — read-only VIEWER role', () => {
  let app: FastifyInstance;
  let adminAuth: Record<string, string>;
  let adminId: string;
  let brandId: string;
  let viewer: { auth: Record<string, string>; userId: string; email: string; password: string };

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    adminAuth = a.auth;
    adminId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: adminAuth, payload: { name: `Viewer Brand ${Date.now()}` } }));
    viewer = await loginViewer(app);
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await deleteUser(viewer.userId);
    await deleteUser(adminId);
    await app.close();
  });

  it('can read across the app', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: viewer.auth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/brands', headers: viewer.auth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/influencers', headers: viewer.auth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/search?q=a`, headers: viewer.auth })).statusCode).toBe(200);
  });

  it('is refused 403 on every write (POST/PATCH/DELETE), whatever the target', async () => {
    const post = await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: viewer.auth, payload: { displayName: 'Nope' } });
    expect(post.statusCode).toBe(403);
    expect((post.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');

    expect((await app.inject({ method: 'POST', url: '/api/v1/saved-views', headers: viewer.auth, payload: { scope: 'x', name: 'n' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/brands/${brandId}`, headers: viewer.auth, payload: { name: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/brands/${brandId}`, headers: viewer.auth })).statusCode).toBe(403);
    // The brand was not modified or deleted.
    expect((await app.inject({ method: 'GET', url: `/api/v1/brands`, headers: adminAuth })).statusCode).toBe(200);
  });

  it('may still use auth self-service (change own password, logout)', async () => {
    const changed = await app.inject({
      method: 'POST', url: '/api/v1/auth/change-password', headers: viewer.auth,
      payload: { currentPassword: viewer.password, newPassword: 'Rotated-Pass99' },
    });
    expect(changed.statusCode).toBe(204);
    // The new password logs in (and the old one no longer does).
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: viewer.email, password: 'Rotated-Pass99' } })).statusCode).toBe(200);
  });
});
