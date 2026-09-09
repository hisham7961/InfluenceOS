import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AuditEntryDTO, CursorPage } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Admin audit log (finding #5). Proves the authorization boundary lives at the
 * API layer (a STAFF token is refused with 403 — the UI check is not the
 * boundary) and that server-side filters actually narrow the result.
 */
describe('platform — admin audit log', () => {
  let app: FastifyInstance;
  let adminAuth: Record<string, string>;
  let adminId: string;
  let staffAuth: Record<string, string>;
  let staffId: string;
  const created: { brandId?: string } = {};

  beforeAll(async () => {
    app = await makeApp();
    const admin = await loginFresh(app);
    adminAuth = admin.auth;
    adminId = admin.userId;

    // A STAFF user + session to prove non-admins are refused at the API.
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `staff_${Date.now()}@example.test`;
    const staff = await prisma.user.create({
      data: { email, name: 'Staff Tester', role: 'STAFF', passwordHash: await hash('Str0ng-Passw0rd!') },
    });
    staffId = staff.id;
    await prisma.$disconnect();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Str0ng-Passw0rd!' } });
    staffAuth = { authorization: `Bearer ${(login.json() as { tokens: { accessToken: string } }).tokens.accessToken}` };
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    if (created.brandId) await prisma.brand.delete({ where: { id: created.brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
    await deleteUser(staffId);
  });

  it('refuses non-admins at the API layer (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/platform/audit', headers: staffAuth });
    expect(res.statusCode).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/platform/audit' });
    expect(res.statusCode).toBe(401);
  });

  it('returns entries for admins and honors server-side filters', async () => {
    // Creating a brand writes a BRAND_CREATED audit entry.
    const name = `Audit Brand ${Date.now()}`;
    const brand = await app.inject({ method: 'POST', url: '/api/v1/brands', headers: adminAuth, payload: { name } });
    created.brandId = (brand.json() as { id: string }).id;

    const all = await app.inject({ method: 'GET', url: '/api/v1/platform/audit?limit=50', headers: adminAuth });
    expect(all.statusCode).toBe(200);
    const page = all.json() as CursorPage<AuditEntryDTO>;
    expect(Array.isArray(page.data)).toBe(true);

    // Filter by action type — only BRAND_CREATED rows come back.
    const byType = await app.inject({ method: 'GET', url: '/api/v1/platform/audit?type=BRAND_CREATED&limit=50', headers: adminAuth });
    const typed = (byType.json() as CursorPage<AuditEntryDTO>).data;
    expect(typed.length).toBeGreaterThan(0);
    expect(typed.every((e) => e.type === 'BRAND_CREATED')).toBe(true);
    expect(typed.some((e) => e.brandId === created.brandId)).toBe(true);

    // Free-text search narrows to our brand.
    const byText = await app.inject({
      method: 'GET',
      url: `/api/v1/platform/audit?q=${encodeURIComponent(name)}&limit=50`,
      headers: adminAuth,
    });
    const found = (byText.json() as CursorPage<AuditEntryDTO>).data;
    expect(found.some((e) => e.message.includes(name))).toBe(true);

    // Entity filter by brand id.
    const byEntity = await app.inject({
      method: 'GET',
      url: `/api/v1/platform/audit?entityType=brand&entityId=${created.brandId}&limit=50`,
      headers: adminAuth,
    });
    const scoped = (byEntity.json() as CursorPage<AuditEntryDTO>).data;
    expect(scoped.every((e) => e.brandId === created.brandId)).toBe(true);
  });
});
