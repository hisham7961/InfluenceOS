import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W1-6 / DB-10 — relationship history must reflect committed collaborations,
 * not invitations. Adding an influencer to a campaign (INVITED) must NOT inflate
 * totalCollaborations or force the relationship ACTIVE; removing must not leave
 * an inflated count. Only a committed participation (CONFIRMED/IN_PROGRESS/
 * COMPLETED) counts, and reverting to DECLINED reverses it.
 */
describe('DB-10 — relationship stats derive from committed participations', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let adminId: string;
  let brandId: string;
  let influencerId: string;
  let campaignId: string;

  async function db() {
    const { PrismaClient } = await import('@influenceos/database');
    return new PrismaClient();
  }

  async function relationship() {
    const prisma = await db();
    const bi = await prisma.brandInfluencer.findUnique({
      where: { brandId_influencerId: { brandId, influencerId } },
    });
    await prisma.$disconnect();
    return bi;
  }

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    adminId = a.userId;
    const brand = await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Rel Brand ${Date.now()}` } });
    brandId = (brand.json() as { id: string }).id;
    const inf = await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Rel Inf ${Date.now()}` } });
    influencerId = (inf.json() as { id: string }).id;
    const camp = await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Rel Camp ${Date.now()}` } });
    campaignId = (camp.json() as { id: string }).id;
  });

  afterAll(async () => {
    const prisma = await db();
    await prisma.campaignInfluencer.deleteMany({ where: { campaignId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
  });

  async function addInfluencer(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/influencers`,
      headers: auth,
      payload: { influencerId, dealType: 'PAID', agreedCost: 1000, currency: 'KWD' },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  it('inviting → decline/remove leaves stats unchanged; committing counts, reverting reverses', async () => {
    // Invite (default participationStatus INVITED) — must NOT count.
    const ciId = await addInfluencer();
    let bi = await relationship();
    expect(bi?.totalCollaborations).toBe(0);
    expect(bi?.relationshipStatus).not.toBe('ACTIVE');
    expect(bi?.firstCollaborationAt).toBeNull();

    // Remove the invitation — still zero (add→remove is a no-op on stats).
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/campaign-influencers/${ciId}`, headers: auth })).statusCode).toBe(204);
    bi = await relationship();
    expect(bi?.totalCollaborations).toBe(0);

    // Add again, then CONFIRM — now it is a real collaboration.
    const ciId2 = await addInfluencer();
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/campaign-influencers/${ciId2}`, headers: auth, payload: { participationStatus: 'CONFIRMED' } })).statusCode).toBe(200);
    bi = await relationship();
    expect(bi?.totalCollaborations).toBe(1);
    expect(bi?.relationshipStatus).toBe('ACTIVE');
    expect(bi?.firstCollaborationAt).not.toBeNull();

    // Revert to DECLINED — the collaboration no longer counts.
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/campaign-influencers/${ciId2}`, headers: auth, payload: { participationStatus: 'DECLINED' } })).statusCode).toBe(200);
    bi = await relationship();
    expect(bi?.totalCollaborations).toBe(0);
  });
});
