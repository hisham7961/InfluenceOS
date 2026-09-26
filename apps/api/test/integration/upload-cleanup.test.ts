import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServices, getStorage, resetStorage, systemContext } from '@influenceos/domain';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';
import type { FastifyInstance } from 'fastify';
import type { AttachmentDTO, UploadTicketDTO } from '@influenceos/contracts';

/**
 * Abandoned-upload cleanup (local driver): objects PUT to storage whose upload
 * was never completed (no Attachment row) are moved to quarantine once past
 * the grace window, while completed attachments are left untouched.
 * Idempotent, and refuses to run when the picture looks wrong.
 *
 * Runs against a private upload dir so the orphan ratio is deterministic.
 */
describe('attachments — abandoned-upload cleanup', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let influencerId: string;
  let uploadDir: string;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'ios-cleanup-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.LOCAL_UPLOAD_DIR = uploadDir;
    resetStorage();
    app = await makeApp();
    const session = await loginFresh(app);
    auth = session.auth;
    userId = session.userId;
    const inf = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers',
      headers: auth,
      payload: { displayName: `Cleanup Target ${Date.now()}`, countryCode: 'KW' },
    });
    influencerId = (inf.json() as { id: string }).id;
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.attachment.deleteMany({ where: { influencerId } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
    process.env.LOCAL_UPLOAD_DIR = savedEnv.LOCAL_UPLOAD_DIR;
    resetStorage();
    await rm(uploadDir, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const k of ['CLEANUP_ENABLED', 'CLEANUP_MAX_ORPHANS']) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('removes orphaned objects but keeps completed attachments', async () => {
    const storage = getStorage(process.env);
    const services = createServices(systemContext());

    // 1. An ORPHAN: bytes written to storage with no Attachment row (a PUT that
    //    was never completed).
    const orphanKey = `attachments/inf/${influencerId}/orphan-${Date.now()}.txt`;
    await storage.save(orphanKey, Buffer.from('orphaned bytes'), 'text/plain');
    expect(await storage.head(orphanKey)).not.toBeNull();

    // 2. A COMPLETED attachment (initiate → PUT → complete), which owns a row.
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const initiate = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: auth,
      payload: { fileName: 'keep.png', mimeType: 'image/png', sizeBytes: bytes.length, target: { influencerId } },
    });
    const ticket = initiate.json() as UploadTicketDTO;
    await app.inject({
      method: 'PUT',
      url: ticket.uploadUrl,
      headers: { ...auth, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    const completed = (await (
      await app.inject({ method: 'POST', url: '/api/v1/files/complete', headers: auth, payload: { uploadToken: ticket.uploadToken } })
    ).json()) as AttachmentDTO;

    const keptKey = (await (async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      const row = await prisma.attachment.findUnique({ where: { id: completed.id }, select: { storageKey: true } });
      await prisma.$disconnect();
      return row?.storageKey ?? '';
    })());
    expect(await storage.head(keptKey)).not.toBeNull();

    // 3. Run cleanup with a zero grace window so the orphan qualifies immediately.
    const res = await services.attachments.cleanupAbandonedUploads(0);
    expect(res.skipped).toBeNull();
    expect(res.quarantined).toBeGreaterThanOrEqual(1);

    // The orphan is parked in quarantine (recoverable), not deleted; the
    // completed attachment's object remains.
    expect(await storage.head(orphanKey)).toBeNull();
    expect(await storage.head(`quarantine/${orphanKey}`)).not.toBeNull();
    expect(await storage.head(keptKey)).not.toBeNull();

    // Idempotent: a second run does not error and touches nothing of ours.
    const again = await services.attachments.cleanupAbandonedUploads(0);
    expect(again.quarantined).toBe(0);
    expect(await storage.head(keptKey)).not.toBeNull();

    // A record whose file sits in quarantine (e.g. after a database restore)
    // gets its file back on the next run.
    await storage.copy(keptKey, `quarantine/${keptKey}`);
    await storage.remove(keptKey);
    const back = await services.attachments.cleanupAbandonedUploads(0);
    expect(back.restored).toBe(1);
    expect(await storage.head(keptKey)).not.toBeNull();
    expect(await storage.head(`quarantine/${keptKey}`)).toBeNull();
  });

  it('does nothing while switched off (file_cleanup flag or CLEANUP_ENABLED=false)', async () => {
    const storage = getStorage(process.env);
    const services = createServices(systemContext());
    const key = `attachments/inf/${influencerId}/kill-switch-${Date.now()}.txt`;
    await storage.save(key, Buffer.from('x'), 'text/plain');

    process.env.CLEANUP_ENABLED = 'false';
    expect((await services.attachments.cleanupAbandonedUploads(0)).skipped).toBe('disabled');
    delete process.env.CLEANUP_ENABLED;

    // The admin flag exists after the first run and switches the pass off too.
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    const flag = await prisma.featureFlag.findFirst({ where: { key: 'file_cleanup', scope: 'PLATFORM', brandId: null } });
    expect(flag?.enabled).toBe(true);
    await prisma.featureFlag.update({ where: { id: flag!.id }, data: { enabled: false } });
    try {
      expect((await services.attachments.cleanupAbandonedUploads(0)).skipped).toBe('disabled');
      expect(await storage.head(key)).not.toBeNull();
    } finally {
      await prisma.featureFlag.update({ where: { id: flag!.id }, data: { enabled: true } });
      await prisma.$disconnect();
    }
    await storage.remove(key);
  });

  it('refuses when most stored files suddenly have no record (wrong or restored database)', async () => {
    const storage = getStorage(process.env);
    const services = createServices(systemContext());
    const keys = [1, 2, 3, 4].map((i) => `attachments/inf/${influencerId}/mass-${i}-${Date.now()}.txt`);
    for (const k of keys) await storage.save(k, Buffer.from('x'), 'text/plain');

    // 4 orphans vs 1 kept file: above the count cap (lowered for the test) and
    // well above a quarter of all files.
    process.env.CLEANUP_MAX_ORPHANS = '2';
    const res = await services.attachments.cleanupAbandonedUploads(0);
    expect(res.skipped).toBe('too-many-orphans');
    expect(res.orphans).toBe(4);
    for (const k of keys) expect(await storage.head(k)).not.toBeNull();

    // Under the cap the same files are quarantined normally.
    process.env.CLEANUP_MAX_ORPHANS = '10';
    const ok = await services.attachments.cleanupAbandonedUploads(0);
    expect(ok.skipped).toBeNull();
    expect(ok.quarantined).toBe(4);
  });
});
