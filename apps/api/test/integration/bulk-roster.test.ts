import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BulkResultDTO, CampaignInfluencerDTO, DeliverableTemplateResultDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W3-4 — bulk roster ops + deliverable templates. Build a large campaign in one
 * or two calls: add many creators at once (each row reported add/skip/fail),
 * then fan a deliverable template across the roster in a single insert.
 */
describe('W3-4 — bulk roster add + deliverable template', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let ids: string[] = [];

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Bulk Brand ${Date.now()}` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Bulk Camp ${Date.now()}` } }));
    for (let i = 0; i < 4; i++) {
      ids.push(idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Bulk Inf ${i} ${Date.now()}`, countryCode: 'KW' } })));
    }
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    for (const id of ids) await prisma.influencer.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('adds many creators in one call, reporting per-row outcomes incl. duplicates', async () => {
    // Pre-add the first creator so the bulk call reports it as skipped.
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId: ids[0], dealType: 'PAID', agreedCost: 100, currency: 'KWD' } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/influencers/bulk`,
      headers: auth,
      payload: {
        rows: [
          { influencerId: ids[0], dealType: 'PAID', agreedCost: 100, currency: 'KWD' }, // already on roster → skipped
          { influencerId: ids[1], dealType: 'FREE' },
          { influencerId: ids[2], dealType: 'GIFTED_PRODUCT', giftedProductValue: 50, currency: 'KWD' },
          { influencerId: 'nonexistent-id', dealType: 'PAID' }, // → failed
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as BulkResultDTO;
    expect(out.added).toBe(2);
    expect(out.skipped).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.results).toHaveLength(4);
    expect(out.results[0]!.status).toBe('skipped');
    expect(out.results[3]!.status).toBe('failed');

    // Roster now has 3 (the pre-added one + two bulk-added).
    const roster = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth })).json() as CampaignInfluencerDTO[];
    expect(roster).toHaveLength(3);
  });

  it('applies a deliverable template across the whole roster in one insert', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/deliverable-template`,
      headers: auth,
      payload: {
        target: 'all',
        deliverables: [
          { platform: 'INSTAGRAM', type: 'REEL', quantity: 1 },
          { platform: 'INSTAGRAM', type: 'STORY', quantity: 3 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const out = res.json() as DeliverableTemplateResultDTO;
    expect(out.rostersTargeted).toBe(3);
    expect(out.deliverablesCreated).toBe(6); // 3 roster × 2 deliverables

    // Every roster member now has the 2 templated deliverables.
    const roster = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth })).json() as CampaignInfluencerDTO[];
    for (const ci of roster) expect(ci.deliverables).toHaveLength(2);
  });

  it('rejects a template targeting a roster row from another campaign', async () => {
    const otherCampaign = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Other ${Date.now()}` } }));
    const foreignCi = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${otherCampaign}/influencers`, headers: auth, payload: { influencerId: ids[3], dealType: 'FREE' } }));
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/deliverable-template`,
      headers: auth,
      payload: { target: [foreignCi], deliverables: [{ platform: 'TIKTOK', type: 'VIDEO' }] },
    });
    expect(res.statusCode).toBe(400);
  });
});
