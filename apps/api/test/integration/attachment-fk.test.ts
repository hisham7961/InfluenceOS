import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { UploadTicketDTO } from '@influenceos/contracts';
import { resetStorage } from '@influenceos/domain';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W2-3 (DB-04) — Attachment.campaignId is now a real FK. Deleting a campaign
 * cleans up its attachments (cascade) instead of leaving orphan rows pointing at
 * a campaign that no longer exists.
 */
describe('attachments — campaign FK cascade (no orphan rows)', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    resetStorage();
    app = await makeApp();
    const s = await loginFresh(app);
    auth = s.auth;
    userId = s.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `FK Brand ${Date.now()}` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `FK Camp ${Date.now()}` } }));
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('deleting a campaign cascades to its attachments', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 3, 3, 3, 3]);
    const initiate = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: auth,
      payload: { fileName: 'brief.png', mimeType: 'image/png', sizeBytes: bytes.length, target: { campaignId } },
    });
    const ticket = initiate.json() as UploadTicketDTO;
    await app.inject({ method: 'PUT', url: ticket.uploadUrl, headers: { ...auth, 'content-type': 'application/octet-stream' }, payload: bytes });
    await app.inject({ method: 'POST', url: '/api/v1/files/complete', headers: auth, payload: { uploadToken: ticket.uploadToken } });

    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    expect(await prisma.attachment.count({ where: { campaignId } })).toBe(1);

    // Deleting the campaign must cascade-remove its attachments (real FK).
    await prisma.campaign.delete({ where: { id: campaignId } });
    expect(await prisma.attachment.count({ where: { campaignId } })).toBe(0);
    await prisma.$disconnect();
  });
});
