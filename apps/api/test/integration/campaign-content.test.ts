import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Paginated, PublishedContentDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

async function loginStaff(app: FastifyInstance): Promise<{ auth: Record<string, string>; userId: string }> {
  const email = `staff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const user = await prisma.user.create({ data: { email, name: 'Scoped Staff', role: 'STAFF', passwordHash: await hash(password) } });
  await prisma.$disconnect();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const tokens = (res.json() as { tokens: { accessToken: string } }).tokens;
  return { auth: { authorization: `Bearer ${tokens.accessToken}` }, userId: user.id };
}

/**
 * Campaign workspace's Live Content tab (workflow pass follow-up) — offset
 * pagination with two buckets: content already linked to this campaign
 * (bucket=linked) and this campaign's roster influencers' content that isn't
 * linked to it yet (bucket=unlinked) — the gap the tab used to hide entirely.
 */
describe("Campaign Live Content — linked vs. roster-unlinked buckets", () => {
  let app: FastifyInstance;
  let adminAuth: Record<string, string>;
  let adminId: string;
  let brandA: string;
  let brandB: string;
  let campaignA: string;
  let campaignB: string;
  let influencerId: string;
  let linked1: string;
  let linked2: string;
  let unlinkedNoCampaign: string;
  let unlinkedOtherCampaign: string;

  const tag = `CC-${Date.now()}`;
  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    adminAuth = a.auth;
    adminId = a.userId;

    brandA = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: adminAuth, payload: { name: `${tag} A` } }));
    brandB = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: adminAuth, payload: { name: `${tag} B` } }));
    campaignA = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: adminAuth, payload: { brandId: brandA, name: `${tag} Camp A` } }));
    campaignB = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: adminAuth, payload: { brandId: brandB, name: `${tag} Camp B` } }));
    influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: adminAuth, payload: { displayName: `${tag} Sara`, countryCode: 'KW' } }),
    );
    // Roster on BOTH campaigns — resolveContentAssociation requires the pair
    // to already be on the roster before content can link campaignId+influencerId together.
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignA}/influencers`, headers: adminAuth, payload: { influencerId, dealType: 'FREE' } });
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignB}/influencers`, headers: adminAuth, payload: { influencerId, dealType: 'FREE' } });

    // linked1: campaignA + this influencer.
    linked1 = idOf(
      await app.inject({
        method: 'POST', url: '/api/v1/content', headers: adminAuth,
        payload: { url: `https://www.youtube.com/watch?v=${tag}L1`, campaignId: campaignA, influencerId },
      }),
    );
    // linked2: campaignA only, no influencer — still counts as linked (campaignId is the only thing that matters for this bucket).
    linked2 = idOf(
      await app.inject({
        method: 'POST', url: '/api/v1/content', headers: adminAuth,
        payload: { url: `https://www.youtube.com/watch?v=${tag}L2`, campaignId: campaignA, brandId: brandA },
      }),
    );
    // unlinkedNoCampaign: this influencer, no campaign at all.
    unlinkedNoCampaign = idOf(
      await app.inject({
        method: 'POST', url: '/api/v1/content', headers: adminAuth,
        payload: { url: `https://www.youtube.com/watch?v=${tag}U1`, influencerId },
      }),
    );
    // unlinkedOtherCampaign: this influencer, but linked to campaign B, not A.
    unlinkedOtherCampaign = idOf(
      await app.inject({
        method: 'POST', url: '/api/v1/content', headers: adminAuth,
        payload: { url: `https://www.youtube.com/watch?v=${tag}U2`, campaignId: campaignB, influencerId },
      }),
    );
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.publishedContent.deleteMany({ where: { originalUrl: { contains: tag } } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: [brandA, brandB] } } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
  });

  it('bucket=linked returns only content whose campaignId is this campaign', async () => {
    const res = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignA}/content?bucket=linked`, headers: adminAuth })
    ).json() as Paginated<PublishedContentDTO>;
    const ids = res.data.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([linked1, linked2]));
    expect(ids).not.toContain(unlinkedNoCampaign);
    expect(ids).not.toContain(unlinkedOtherCampaign);
    expect(res.pagination.total).toBe(2);
  });

  it("bucket=unlinked returns the roster influencer's content not linked to this campaign", async () => {
    const res = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignA}/content?bucket=unlinked`, headers: adminAuth })
    ).json() as Paginated<PublishedContentDTO>;
    const ids = res.data.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([unlinkedNoCampaign, unlinkedOtherCampaign]));
    expect(ids).not.toContain(linked1);
    expect(ids).not.toContain(linked2);
    expect(res.pagination.total).toBe(2);
  });

  it('defaults to bucket=linked when omitted', async () => {
    const res = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignA}/content`, headers: adminAuth })
    ).json() as Paginated<PublishedContentDTO>;
    expect(res.data.map((c) => c.id)).toEqual(expect.arrayContaining([linked1, linked2]));
  });

  it('paginates with a real total/totalPages, unlike the old hard-capped fetch', async () => {
    const res = (
      await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignA}/content?bucket=linked&page=1&pageSize=1`, headers: adminAuth })
    ).json() as Paginated<PublishedContentDTO>;
    expect(res.data).toHaveLength(1);
    expect(res.pagination.total).toBe(2);
    expect(res.pagination.totalPages).toBe(2);
  });

  it('a staff user scoped to a different brand cannot reach this campaign', async () => {
    const staff = await loginStaff(app);
    await app.inject({ method: 'PUT', url: `/api/v1/users/${staff.userId}/brand-access`, headers: adminAuth, payload: { brandIds: [brandB] } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignA}/content?bucket=linked`, headers: staff.auth });
    expect(res.statusCode).toBe(404);
    await deleteUser(staff.userId);
  });
});
