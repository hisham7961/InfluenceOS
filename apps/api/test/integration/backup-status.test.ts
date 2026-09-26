import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PlatformStatusDTO } from '@influenceos/contracts';
import type { PrismaClient } from '@influenceos/database';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P0.2 — scripts/backup.sh records each run in BackupRun; Settings → Platform
 * reads the latest good and failed run per kind from GET /platform/status and
 * flags a database backup older than 36 hours.
 */
describe('P0.2 — backup status on /platform/status', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let prisma: PrismaClient;
  const hour = 3600e3;

  const status = async () =>
    (await app.inject({ method: 'GET', url: '/api/v1/platform/status', headers: auth })).json() as PlatformStatusDTO;

  beforeAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    await prisma.backupRun.deleteMany();
    app = await makeApp();
    ({ auth, userId } = await loginFresh(app));
  });

  afterAll(async () => {
    await prisma.backupRun.deleteMany();
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('reports "never" and stale when nothing was recorded', async () => {
    const s = await status();
    expect(s.backups.stale).toBe(true);
    expect(s.backups.database.lastSuccessAt).toBeNull();
    expect(s.backups.files.lastSuccessAt).toBeNull();
  });

  it('reports the latest good and failed run per kind', async () => {
    const at = (h: number) => new Date(Date.now() - h * hour);
    await prisma.backupRun.createMany({
      data: [
        { kind: 'database', ok: true, startedAt: at(50), finishedAt: at(50), sizeBytes: 100n, offsite: false },
        { kind: 'database', ok: true, startedAt: at(3), finishedAt: at(3), sizeBytes: 2048n, offsite: true },
        { kind: 'database', ok: false, startedAt: at(1), finishedAt: at(1), message: 'pg_dump failed' },
        { kind: 'files', ok: true, startedAt: at(3), finishedAt: at(3), sizeBytes: 5_000_000n, offsite: false },
        { kind: 'restore-test', ok: true, startedAt: at(20), finishedAt: at(20), message: '3 users' },
      ],
    });
    const s = await status();
    expect(s.backups.stale).toBe(false);
    expect(Date.parse(s.backups.database.lastSuccessAt!)).toBeCloseTo(Date.now() - 3 * hour, -5);
    expect(s.backups.database.sizeBytes).toBe(2048);
    expect(s.backups.database.offsite).toBe(true);
    expect(s.backups.database.lastFailureAt).not.toBeNull();
    expect(s.backups.files.sizeBytes).toBe(5_000_000);
    expect(s.backups.files.offsite).toBe(false);
    expect(s.backups.restoreTest.lastSuccessAt).not.toBeNull();
  });

  it('flags a database backup older than 36 hours as stale', async () => {
    await prisma.backupRun.deleteMany({ where: { kind: 'database', ok: true, sizeBytes: 2048n } });
    expect((await status()).backups.stale).toBe(true);
  });
});
