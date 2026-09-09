import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AttachmentDTO, UploadTicketDTO } from '@influenceos/contracts';
import { resetStorage, signDownloadTicket, verifyDownloadTicket } from '@influenceos/domain';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * File authorization (item 75): a signed download ticket is a narrowly-scoped,
 * expiring capability. A ticket minted for one attachment must not open another,
 * a tampered ticket must be refused, a missing ticket must be refused, and an
 * expired ticket must be refused. Also: initiating an upload requires auth.
 */
describe('files — signed-download authorization', () => {
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
    const inf = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers',
      headers: auth,
      payload: { displayName: `FileAuthz ${Date.now()}` },
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

  async function upload(name: string): Promise<AttachmentDTO> {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const initiate = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: auth,
      payload: { fileName: name, mimeType: 'image/png', sizeBytes: bytes.length, target: { influencerId } },
    });
    const ticket = initiate.json() as UploadTicketDTO;
    await app.inject({
      method: 'PUT',
      url: ticket.uploadUrl,
      headers: { ...auth, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    return (
      await app.inject({ method: 'POST', url: '/api/v1/files/complete', headers: auth, payload: { uploadToken: ticket.uploadToken } })
    ).json() as AttachmentDTO;
  }

  function tokenOf(url: string): string {
    return decodeURIComponent(url.split('token=')[1] ?? '');
  }

  it("a ticket minted for file A cannot download file B", async () => {
    const a = await upload('a.png');
    const b = await upload('b.png');
    const aToken = tokenOf(a.downloadUrl);
    // A's own link works …
    expect((await app.inject({ method: 'GET', url: a.downloadUrl })).statusCode).toBe(200);
    // … but A's token on B's blob endpoint is refused (attachment-id mismatch).
    const cross = await app.inject({ method: 'GET', url: `/api/v1/files/${b.id}/blob?token=${encodeURIComponent(aToken)}` });
    expect(cross.statusCode).toBeGreaterThanOrEqual(400);
    expect(cross.statusCode).toBeLessThan(500);
  });

  it('a tampered ticket is refused', async () => {
    const a = await upload('c.png');
    const token = tokenOf(a.downloadUrl);
    const tampered = token.slice(0, -3) + (token.endsWith('AAA') ? 'BBB' : 'AAA');
    const res = await app.inject({ method: 'GET', url: `/api/v1/files/${a.id}/blob?token=${encodeURIComponent(tampered)}` });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it('a missing ticket is refused', async () => {
    const a = await upload('d.png');
    const res = await app.inject({ method: 'GET', url: `/api/v1/files/${a.id}/blob` });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('an expired ticket is refused (signed URLs expire)', async () => {
    const a = await upload('e.png');
    // Mint a ticket that is already effectively expired (1s TTL), then wait.
    const shortLived = await signDownloadTicket(a.id, 1);
    await new Promise((r) => setTimeout(r, 1300));
    await expect(verifyDownloadTicket(shortLived)).rejects.toBeTruthy();
    const res = await app.inject({ method: 'GET', url: `/api/v1/files/${a.id}/blob?token=${encodeURIComponent(shortLived)}` });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});
