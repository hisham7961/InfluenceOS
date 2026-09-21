import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CreatorTimelineItemDTO, DeliverableSubmissionDTO, ProductShipmentDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Final Completion Pass — gap #11 (dedicated Creator 360 UGC/Shipment History
 * tabs) and gap #12 (Contacted/Usage Right timeline events). Covers:
 *  - GET /influencers/:id/submissions — every DeliverableSubmission across
 *    every campaign this creator has been on.
 *  - GET /shipments?influencerId=… — every ProductShipment across every
 *    campaign this creator has been on (the pre-existing cross-campaign
 *    logistics endpoint, reused rather than duplicated).
 *  - timeline()'s new 'contacted' and 'usageRights' buckets, including the
 *    negative case: a CampaignInfluencer with no dateContacted produces no
 *    Contacted event.
 */
describe('Final Completion Pass — Creator 360 UGC/Shipment tabs + timeline gap #12', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let influencerId: string;
  let ciContactedId: string;
  let ciNoContactId: string;
  let deliverableId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const day = 864e5;
  const daysAgo = (n: number) => new Date(Date.now() - n * day).toISOString();

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `C360Tabs Brand ${Date.now()}` } }));
    campaignId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `C360Tabs Camp ${Date.now()}`, currency: 'KWD' } }),
    );
    influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `C360Tabs Creator ${Date.now()}`, countryCode: 'KW' } }),
    );

    // Roster row WITH a real dateContacted — should produce a 'contacted' timeline event.
    ciContactedId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/influencers`,
        headers: auth,
        payload: { influencerId, dealType: 'PAID', agreedCost: 300, currency: 'KWD', dateContacted: daysAgo(5) },
      }),
    );

    // A second campaign whose roster row has NO dateContacted — negative case.
    const campaign2Id = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `C360Tabs Camp2 ${Date.now()}`, currency: 'KWD' } }),
    );
    ciNoContactId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaign2Id}/influencers`,
        headers: auth,
        payload: { influencerId, dealType: 'FREE' },
      }),
    );

    // A deliverable + submission for the UGC tab.
    deliverableId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciContactedId}/deliverables`,
        headers: auth,
        payload: { platform: 'INSTAGRAM', type: 'REEL' },
      }),
    );
    await app.inject({
      method: 'POST',
      url: `/api/v1/deliverables/${deliverableId}/submissions`,
      headers: auth,
      payload: { notes: 'First draft', assetUrl: 'https://example.com/draft.mp4' },
    });

    // A shipment against the same campaign participation, for the Shipment History tab.
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciContactedId}/shipments`,
      headers: auth,
      payload: { recipientName: 'C360 Tester', city: 'Kuwait City', country: 'Kuwait', courier: 'DHL', trackingNumber: 'C360TRK1', status: 'SHIPPED' },
    });

    // A usage right for this creator — should produce a 'usageRights' timeline event.
    await app.inject({
      method: 'POST',
      url: `/api/v1/brands/${brandId}/usage-rights`,
      headers: auth,
      payload: { campaignId, influencerId, usageType: 'PAID_ADS', territory: 'KW', scope: 'Paid social', startsAt: daysAgo(5), expiresAt: null },
    });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('GET /influencers/:id/submissions returns every submission across every campaign, with campaign context', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/submissions`, headers: auth });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as (DeliverableSubmissionDTO & { campaignId: string; campaignName: string })[];
    expect(rows).toHaveLength(1);
    const s = rows[0]!;
    expect(s.deliverableId).toBe(deliverableId);
    expect(s.notes).toBe('First draft');
    expect(s.status).toBe('IN_REVIEW');
    expect(s.campaignId).toBe(campaignId);
    expect(typeof s.campaignName).toBe('string');
  });

  it('GET /shipments?influencerId=… returns every shipment across every campaign this creator has been on', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/shipments?influencerId=${influencerId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: ProductShipmentDTO[] };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const s = body.data.find((row) => row.trackingNumber === 'C360TRK1');
    expect(s).toBeDefined();
    expect(s!.courier).toBe('DHL');
    expect(s!.status).toBe('SHIPPED');
  });

  it("timeline() emits a 'contacted' event only for the roster row with a real dateContacted, never a fabricated one", async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/timeline?limit=50`, headers: auth });
    expect(res.statusCode).toBe(200);
    const timeline = res.json() as { data: CreatorTimelineItemDTO[] };

    const contactedEvents = timeline.data.filter((i) => i.bucket === 'contacted');
    expect(contactedEvents).toHaveLength(1);
    expect(contactedEvents[0]!.id).toBe(`contacted:${ciContactedId}`);
    expect(contactedEvents[0]!.message).toContain('Contacted for');
    // Negative case — the second roster row (ciNoContactId) has no dateContacted
    // and must never produce a synthesized event.
    expect(timeline.data.some((i) => i.id === `contacted:${ciNoContactId}`)).toBe(false);
  });

  it("timeline() emits a 'usageRights' event anchored on the real UsageRight.createdAt", async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/timeline?limit=50`, headers: auth });
    expect(res.statusCode).toBe(200);
    const timeline = res.json() as { data: CreatorTimelineItemDTO[] };

    const rightsEvents = timeline.data.filter((i) => i.bucket === 'usageRights');
    expect(rightsEvents).toHaveLength(1);
    expect(rightsEvents[0]!.message).toContain('Usage right granted');
    expect(rightsEvents[0]!.message.toLowerCase()).toContain('paid ads');
    expect(rightsEvents[0]!.link).toBe(`/campaigns/${campaignId}`);
    expect(typeof rightsEvents[0]!.at).toBe('string');
  });

  it('timeline() still surfaces the real UGC submission event alongside the new buckets', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/timeline?limit=50`, headers: auth });
    const timeline = (res.json() as { data: CreatorTimelineItemDTO[] }).data;
    expect(timeline.some((i) => i.bucket === 'ugc')).toBe(true);
  });
});
