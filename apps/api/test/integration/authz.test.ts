import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FEATURES } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Authorization tests (finding #9). The contract test proves routes EXIST; this
 * proves the admin ones ENFORCE admin at the API layer — a STAFF token is
 * refused with 403, an ADMIN token is allowed. This is the security dimension
 * the OpenAPI check cannot verify.
 */
describe('authz — admin-only endpoints enforce ADMIN at the API layer', () => {
  let app: FastifyInstance;
  let adminAuth: Record<string, string>;
  let adminId: string;
  let staffAuth: Record<string, string>;
  let staffId: string;

  beforeAll(async () => {
    app = await makeApp();
    const admin = await loginFresh(app);
    adminAuth = admin.auth;
    adminId = admin.userId;

    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `staff_authz_${Date.now()}@example.test`;
    const staff = await prisma.user.create({
      data: { email, name: 'Staff Authz', role: 'STAFF', passwordHash: await hash('Str0ng-Passw0rd!') },
    });
    staffId = staff.id;
    await prisma.$disconnect();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Str0ng-Passw0rd!' } });
    staffAuth = { authorization: `Bearer ${(login.json() as { tokens: { accessToken: string } }).tokens.accessToken}` };
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(adminId);
    await deleteUser(staffId);
  });

  // A representative set of admin-only GET endpoints (safe, side-effect free).
  const ADMIN_GET_ENDPOINTS = ['/api/v1/platform/storage', '/api/v1/platform/audit', '/api/v1/platform/flags', '/api/v1/users'];

  for (const url of ADMIN_GET_ENDPOINTS) {
    it(`${url} → 403 for STAFF, 200 for ADMIN`, async () => {
      const staff = await app.inject({ method: 'GET', url, headers: staffAuth });
      expect(staff.statusCode).toBe(403);
      const admin = await app.inject({ method: 'GET', url, headers: adminAuth });
      expect(admin.statusCode).toBe(200);
    });
  }

  it('every registry feature restricted to ADMIN has its GET endpoints refuse STAFF', async () => {
    const adminOnlyGets = FEATURES.filter((f) => f.permissions.length === 1 && f.permissions[0] === 'ADMIN')
      .flatMap((f) => f.apiEndpoints)
      .filter((e) => e.startsWith('GET '))
      .map((e) => e.slice(4))
      .filter((p) => !p.includes(':') && !p.includes('{')); // skip parameterized

    // De-dup.
    for (const path of [...new Set(adminOnlyGets)]) {
      const res = await app.inject({ method: 'GET', url: path, headers: staffAuth });
      expect(res.statusCode, `${path} should refuse STAFF`).toBe(403);
    }
  });
});
