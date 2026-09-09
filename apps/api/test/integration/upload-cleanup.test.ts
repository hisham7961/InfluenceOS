import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServices, getStorage, resetStorage, systemContext } from '@influenceos/domain';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';
import type { FastifyInstance } from 'fastify';
import type { AttachmentDTO, UploadTicketDTO } from '@influenceos/contracts';

/**
 * Abandoned-upload cleanup (local driver): objects PUT to storage whose upload
 * was never completed (no Attachment row) are removed once past the grace
 * window, while completed attachments are left untouched. Idempotent.
 */
describe('attachments — abandoned-upload cleanup', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let influencerId: string;

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    resetStorage();
    app = await makeApp();
    const session = await loginFresh(app);
    auth = session.auth;
    userId = session.userId;
    const inf = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers',
      headers: auth,
      payload: { displayName: `Cleanup Target ${Date.now()}` },
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
    const deleted = await services.attachments.cleanupAbandonedUploads(0);
    expect(deleted).toBeGreaterThanOrEqual(1);

    // The orphan is gone; the completed attachment's object remains.
    expect(await storage.head(orphanKey)).toBeNull();
    expect(await storage.head(keptKey)).not.toBeNull();

    // Idempotent: a second run does not error and removes nothing new of ours.
    await services.attachments.cleanupAbandonedUploads(0);
    expect(await storage.head(keptKey)).not.toBeNull();
  });
});
