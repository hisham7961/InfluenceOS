import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AttachmentDTO, UploadTicketDTO } from '@influenceos/contracts';
import { resetStorage } from '@influenceos/domain';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W2-2 (WK-05) — completing an upload is idempotent. A replayed completion for
 * the same storage key returns the SAME attachment instead of inserting a
 * duplicate row (enforced in the service and by the storageKey unique index).
 */
describe('files — idempotent completion', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let influencerId: string;

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    resetStorage();
    app = await makeApp();
    const s = await loginFresh(app);
    auth = s.auth;
    userId = s.userId;
    influencerId = (
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Idem ${Date.now()}` } })
    ).json().id as string;
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

  it('replaying complete with the same token returns one attachment, not two', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 5, 6, 7, 8]);
    const initiate = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: auth,
      payload: { fileName: 'once.png', mimeType: 'image/png', sizeBytes: bytes.length, target: { influencerId } },
    });
    const ticket = initiate.json() as UploadTicketDTO;
    await app.inject({
      method: 'PUT',
      url: ticket.uploadUrl,
      headers: { ...auth, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });

    const first = await app.inject({ method: 'POST', url: '/api/v1/files/complete', headers: auth, payload: { uploadToken: ticket.uploadToken } });
    const second = await app.inject({ method: 'POST', url: '/api/v1/files/complete', headers: auth, payload: { uploadToken: ticket.uploadToken } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const a = first.json() as AttachmentDTO;
    const b = second.json() as AttachmentDTO;
    expect(b.id).toBe(a.id); // same row, not a duplicate

    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    const count = await prisma.attachment.count({ where: { influencerId } });
    await prisma.$disconnect();
    expect(count).toBe(1);
  });
});
