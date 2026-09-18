import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/** Provision a throwaway STAFF (non-admin) user and return an auth header. */
async function loginStaff(app: FastifyInstance): Promise<{ auth: Record<string, string>; userId: string; email: string; password: string }> {
  const email = `staff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const user = await prisma.user.create({ data: { email, name: 'Test Staff', role: 'STAFF', passwordHash: await hash(password) } });
  await prisma.$disconnect();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const tokens = (res.json() as { tokens: { accessToken: string } }).tokens;
  return { auth: { authorization: `Bearer ${tokens.accessToken}` }, userId: user.id, email, password };
}

async function setMaintenance(app: FastifyInstance, auth: Record<string, string>, on: boolean): Promise<void> {
  await app.inject({ method: 'PATCH', url: '/api/v1/platform/client-config', headers: auth, payload: { maintenanceMode: on } });
}

/**
 * W4-2 — the `maintenanceMode` setting is real, not decorative. When it is on,
 * non-admin writes are refused with 503 while reads still work, admins keep full
 * access (so they can turn it off), and auth endpoints stay open so an admin can
 * sign in.
 */
describe('W4-2 — maintenance mode gate', () => {
  let app: FastifyInstance;
  let adminAuth: Record<string, string>;
  let adminId: string;
  let staff: { auth: Record<string, string>; userId: string; email: string; password: string };

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    adminAuth = a.auth;
    adminId = a.userId;
    staff = await loginStaff(app);
    await setMaintenance(app, adminAuth, false); // known clean state
  });

  afterAll(async () => {
    await setMaintenance(app, adminAuth, false); // never leave maintenance on for other suites
    await deleteUser(staff.userId);
    await deleteUser(adminId);
    await app.close();
  });

  it('blocks a non-admin write with 503 while allowing reads and admin writes', async () => {
    // Baseline: staff can write while maintenance is off.
    const ok = await app.inject({ method: 'POST', url: '/api/v1/saved-views', headers: staff.auth, payload: { scope: 'x', name: 'before' } });
    expect(ok.statusCode).toBe(201);

    await setMaintenance(app, adminAuth, true);

    // Staff write is refused with 503 MAINTENANCE.
    const blocked = await app.inject({ method: 'POST', url: '/api/v1/saved-views', headers: staff.auth, payload: { scope: 'x', name: 'during' } });
    expect(blocked.statusCode).toBe(503);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe('MAINTENANCE');

    // Staff reads still work.
    expect((await app.inject({ method: 'GET', url: '/api/v1/saved-views', headers: staff.auth })).statusCode).toBe(200);

    // Admins keep full access (so they can operate + turn maintenance off).
    const adminWrite = await app.inject({ method: 'POST', url: '/api/v1/saved-views', headers: adminAuth, payload: { scope: 'x', name: 'admin-during' } });
    expect(adminWrite.statusCode).toBe(201);

    // Auth endpoints stay open so an admin can still sign in.
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: staff.email, password: staff.password } })).statusCode).toBe(200);
  });

  it('restores normal writes once maintenance is turned off', async () => {
    await setMaintenance(app, adminAuth, false);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/saved-views', headers: staff.auth, payload: { scope: 'x', name: 'after' } });
    expect(ok.statusCode).toBe(201);
  });
});
