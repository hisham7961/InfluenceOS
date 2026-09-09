import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AttachmentDTO, UploadTicketDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * End-to-end two-phase signed upload over the local driver:
 *   initiate → PUT bytes to the signed proxy → complete → list → signed
 *   download → delete. Also asserts the security invariants: MIME allowlist,
 *   size ceiling, private-by-default (no public URL), and signed download.
 */
describe('files — two-phase signed uploads (local driver)', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let influencerId: string;

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    app = await makeApp();
    const session = await loginFresh(app);
    auth = session.auth;
    userId = session.userId;

    // A target the attachment can hang off.
    const inf = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers',
      headers: auth,
      payload: { displayName: `File Target ${Date.now()}` },
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

  async function uploadPng(bytes: Buffer): Promise<AttachmentDTO> {
    const initiate = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: auth,
      payload: { fileName: 'photo.png', mimeType: 'image/png', sizeBytes: bytes.length, target: { influencerId } },
    });
    expect(initiate.statusCode).toBe(201);
    const ticket = initiate.json() as UploadTicketDTO;
    // Local driver → relative proxy path, not a public URL.
    expect(ticket.direct).toBe(false);
    expect(ticket.uploadUrl).toContain('/files/blob');

    const put = await app.inject({
      method: 'PUT',
      url: ticket.uploadUrl,
      headers: { ...auth, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    expect(put.statusCode).toBe(204);

    const complete = await app.inject({
      method: 'POST',
      url: '/api/v1/files/complete',
      headers: auth,
      payload: { uploadToken: ticket.uploadToken },
    });
    expect(complete.statusCode).toBe(201);
    return complete.json() as AttachmentDTO;
  }

  it('uploads, lists, downloads via a signed URL, and deletes', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
    const created = await uploadPng(bytes);
    expect(created.kind).toBe('image');
    expect(created.sizeBytes).toBe(bytes.length);
    // Private by default: the download URL is a signed proxy path, never public.
    expect(created.downloadUrl).toContain('/files/');
    expect(created.downloadUrl).toContain('token=');
    expect(created.downloadUrl).not.toContain('X-Amz'); // not a bare public URL

    const list = await app.inject({ method: 'GET', url: `/api/v1/files?influencerId=${influencerId}`, headers: auth });
    expect(list.statusCode).toBe(200);
    expect((list.json() as AttachmentDTO[]).some((a) => a.id === created.id)).toBe(true);

    // The signed URL streams the bytes back WITHOUT a session (token = capability).
    const dl = await app.inject({ method: 'GET', url: created.downloadUrl });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.length).toBe(bytes.length);

    // Tampering with / dropping the token is refused.
    const noToken = await app.inject({ method: 'GET', url: `/api/v1/files/${created.id}/blob` });
    expect(noToken.statusCode).toBeGreaterThanOrEqual(400);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/files/${created.id}`, headers: auth });
    expect(del.statusCode).toBe(204);
  });

  it('rejects a disallowed MIME type at initiate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: auth,
      payload: { fileName: 'evil.exe', mimeType: 'application/x-msdownload', sizeBytes: 10, target: { influencerId } },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects an oversized declared file at initiate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: auth,
      payload: {
        fileName: 'huge.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 10 * 1024 * 1024 * 1024,
        target: { influencerId },
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('requires authentication to initiate an upload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      payload: { fileName: 'x.png', mimeType: 'image/png', sizeBytes: 5, target: { influencerId } },
    });
    expect(res.statusCode).toBe(401);
  });
});
