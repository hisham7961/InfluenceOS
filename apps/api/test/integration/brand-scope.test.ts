import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BrandSummaryDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

async function loginStaff(app: FastifyInstance): Promise<{ auth: Record<string, string>; userId: string }> {
  const email = `staff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const user = await prisma.user.create({ data: { email, name: 'Scoped Staff', role: 'STAFF', passwordHash: await hash(password) } });
  await prisma.$disconnect();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const tokens = (res.json() as { tokens: { accessToken: string } }).tokens;
  return { auth: { authorization: `Bearer ${tokens.accessToken}` }, userId: user.id };
}

/**
 * W4-4 — per-user brand scope. A staff user with brand-access rows sees only
 * those brands and cannot reach others; clearing the scope restores full
 * visibility. Admins are always unscoped. Opt-in: a user with no rows is
 * unaffected.
 */
describe('W4-4 — per-user brand scope', () => {
  let app: FastifyInstance;
  let adminAuth: Record<string, string>;
  let adminId: string;
  let staff: { auth: Record<string, string>; userId: string };
  let brandA: { id: string; slug: string };
  let brandB: { id: string; slug: string };

  const tag = Date.now();

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    adminAuth = a.auth;
    adminId = a.userId;
    brandA = (await app.inject({ method: 'POST', url: '/api/v1/brands', headers: adminAuth, payload: { name: `Scope A ${tag}` } })).json() as { id: string; slug: string };
    brandB = (await app.inject({ method: 'POST', url: '/api/v1/brands', headers: adminAuth, payload: { name: `Scope B ${tag}` } })).json() as { id: string; slug: string };
    staff = await loginStaff(app);
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.brand.deleteMany({ where: { id: { in: [brandA.id, brandB.id] } } }).catch(() => undefined);
    await prisma.$disconnect();
    await deleteUser(staff.userId);
    await deleteUser(adminId);
    await app.close();
  });

  const brandIds = (r: { json: () => unknown }) => (r.json() as BrandSummaryDTO[]).map((b) => b.id);

  it('an unscoped staff user sees every brand', async () => {
    const ids = brandIds(await app.inject({ method: 'GET', url: '/api/v1/brands', headers: staff.auth }));
    expect(ids).toEqual(expect.arrayContaining([brandA.id, brandB.id]));
  });

  it('scoping the user to brand A hides brand B and blocks direct access', async () => {
    const set = await app.inject({ method: 'PUT', url: `/api/v1/users/${staff.userId}/brand-access`, headers: adminAuth, payload: { brandIds: [brandA.id] } });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual([brandA.id]);

    const ids = brandIds(await app.inject({ method: 'GET', url: '/api/v1/brands', headers: staff.auth }));
    expect(ids).toContain(brandA.id);
    expect(ids).not.toContain(brandB.id);

    // Direct access to the out-of-scope brand reads as not-found.
    expect((await app.inject({ method: 'GET', url: `/api/v1/brands/${brandB.slug}`, headers: staff.auth })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/v1/brands/${brandA.slug}`, headers: staff.auth })).statusCode).toBe(200);

    // An admin is never scoped — still sees both.
    const adminIds = brandIds(await app.inject({ method: 'GET', url: '/api/v1/brands', headers: adminAuth }));
    expect(adminIds).toEqual(expect.arrayContaining([brandA.id, brandB.id]));
  });

  it('exposes the scope to admins and validates brand ids', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/v1/users/${staff.userId}/brand-access`, headers: adminAuth })).json()).toEqual([brandA.id]);
    const bad = await app.inject({ method: 'PUT', url: `/api/v1/users/${staff.userId}/brand-access`, headers: adminAuth, payload: { brandIds: ['does-not-exist'] } });
    expect(bad.statusCode).toBe(400);
  });

  it('clearing the scope restores full visibility', async () => {
    await app.inject({ method: 'PUT', url: `/api/v1/users/${staff.userId}/brand-access`, headers: adminAuth, payload: { brandIds: [] } });
    const ids = brandIds(await app.inject({ method: 'GET', url: '/api/v1/brands', headers: staff.auth }));
    expect(ids).toEqual(expect.arrayContaining([brandA.id, brandB.id]));
  });
});
