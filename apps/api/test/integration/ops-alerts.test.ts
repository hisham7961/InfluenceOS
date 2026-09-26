import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';
import { resetEnv } from '../../src/env.ts';

/**
 * P2.4 — problems reach the admins instead of waiting for a client to notice:
 * a platform whose syncs all fail is recorded on Admin → Integrations and
 * alerts every admin (once a day, not every sweep); "Test connection" makes a
 * real provider call or says plainly that there is nothing to call; the API
 * docs are off in production unless switched on.
 */
describe('P2.4 — sync health, admin alerts, connection test, API docs switch', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let adminId: string;
  const tag = `OPS${Date.now()}`;
  let influencerId: string;
  // Far enough ahead that only this suite's rows fall in the 24-hour window.
  const future = new Date(Date.now() + 400 * 864e5);
  let savedSetting: { lastError: string | null; lastSuccessAt: Date | null } | null = null;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    adminId = a.userId;
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    savedSetting = await prisma.integrationSetting.findUnique({
      where: { platform: 'X' },
      select: { lastError: true, lastSuccessAt: true },
    });
    const inf = await prisma.influencer.create({ data: { displayName: `${tag} Creator`, countryCode: 'KW' } });
    influencerId = inf.id;
    for (let i = 0; i < 3; i++) {
      await prisma.socialAccount.create({
        data: {
          influencerId,
          platform: 'X',
          username: `${tag.toLowerCase()}_${i}`,
          profileUrl: `https://x.com/${tag.toLowerCase()}_${i}`,
          lastSyncAttemptAt: future,
          lastSyncError: 'HTTP 401 — token revoked',
        },
      });
    }
    await prisma.$disconnect();
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.socialAccount.deleteMany({ where: { influencerId } });
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.notification.deleteMany({ where: { title: { in: ['X sync is failing', `${tag} alert`] } } });
    if (savedSetting) {
      await prisma.integrationSetting.update({ where: { platform: 'X' }, data: savedSetting });
    } else {
      await prisma.integrationSetting.deleteMany({ where: { platform: 'X' } });
    }
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
  });

  it('records a failing platform on its integration settings and alerts the admins', async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const { recordSyncHealth } = await import('@influenceos/domain');
    const prisma = new PrismaClient();
    const health = await recordSyncHealth(prisma, future);
    const x = health.find((h) => h.platform === 'X');
    expect(x).toMatchObject({ failures: 3, successes: 0, failing: true });

    const setting = await prisma.integrationSetting.findUnique({ where: { platform: 'X' } });
    expect(setting?.lastError).toContain('Follower sync is failing: HTTP 401');
    const mine = await prisma.notification.findMany({ where: { userId: adminId, title: 'X sync is failing' } });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.category).toBe('SYNC_FAILURE');
    expect(mine[0]!.targetUrl).toBe('/settings/integrations');
    await prisma.$disconnect();

    // The admin sees it through the API like any notification.
    const list = (await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: auth })).json() as {
      data: { title: string }[];
    };
    expect(list.data.some((n) => n.title === 'X sync is failing')).toBe(true);
  });

  it('alerts each admin once per window, not on every sweep', async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const { alertAdmins } = await import('@influenceos/domain');
    const prisma = new PrismaClient();
    const alert = { title: `${tag} alert`, body: 'Something broke.' };
    const first = await alertAdmins(prisma, alert);
    expect(first).toBeGreaterThan(0);
    expect(await alertAdmins(prisma, alert)).toBe(0);
    expect(await prisma.notification.count({ where: { userId: adminId, title: alert.title } })).toBe(1);
    await prisma.$disconnect();
  });

  it('"Test connection" never claims a connection it did not make', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/SNAPCHAT/test', headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; message: string };
    expect(body.message).not.toMatch(/reachable/);
    if (!body.ok) expect(body.message).toBe('No credential configured.');
  });

  it('serves the API docs only when switched on (off by default in production)', async () => {
    const saved = { node: process.env.NODE_ENV, docs: process.env.API_DOCS };
    try {
      process.env.API_DOCS = 'off';
      resetEnv();
      const off = await makeApp();
      expect((await off.inject({ method: 'GET', url: '/api/openapi.json' })).statusCode).toBe(404);
      expect((await off.inject({ method: 'GET', url: '/api/docs' })).statusCode).toBe(404);
      // The spec is still built in-process (SDK generation, contract test).
      expect((off.swagger() as { openapi: string }).openapi).toMatch(/^3\./);
      await off.close();

      process.env.API_DOCS = 'on';
      resetEnv();
      const on = await makeApp();
      expect((await on.inject({ method: 'GET', url: '/api/openapi.json' })).statusCode).toBe(200);
      await on.close();
    } finally {
      if (saved.docs === undefined) delete process.env.API_DOCS;
      else process.env.API_DOCS = saved.docs;
      process.env.NODE_ENV = saved.node;
      resetEnv();
    }
  });
});
