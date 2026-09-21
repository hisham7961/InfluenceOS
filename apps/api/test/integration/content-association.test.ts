import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Content association architecture (docs/workflow/ENTITY_RELATIONSHIP_AUDIT.md,
 * docs/workflow/WORKFLOW_GAP_MATRIX.md) — end-to-end through the real HTTP API
 * against a real database, covering the brief's lettered scenarios.
 */
describe('Content association — create/update through the real API', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let otherBrandId: string;
  let influencerId: string;
  let otherInfluencerId: string;
  let campaignId: string;
  let otherCampaignId: string;
  let ciId: string;
  let deliverableId: string;
  let otherDeliverableId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const tag = `CA-${Date.now()}`;
  let urlSeq = 0;
  const freshUrl = () => `https://www.youtube.com/watch?v=${tag}${urlSeq++}`;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `${tag} Brand` } }));
    otherBrandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `${tag} Other Brand` } }));
    influencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `${tag} Sara`, countryCode: 'KW' } }));
    otherInfluencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `${tag} Ahmed`, countryCode: 'KW' } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `${tag} Campaign A` } }));
    otherCampaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId: otherBrandId, name: `${tag} Campaign B` } }));
    ciId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/influencers`,
        headers: auth,
        payload: { influencerId, dealType: 'FREE' },
      }),
    );
    deliverableId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/deliverables`,
        headers: auth,
        payload: { platform: 'INSTAGRAM', type: 'REEL' },
      }),
    );
    // A deliverable that belongs to a DIFFERENT campaign/influencer entirely —
    // used to prove cross-campaign mismatches are rejected (SCENARIO F).
    const otherCi = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${otherCampaignId}/influencers`,
        headers: auth,
        payload: { influencerId: otherInfluencerId, dealType: 'FREE' },
      }),
    );
    otherDeliverableId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${otherCi}/deliverables`,
        headers: auth,
        payload: { platform: 'INSTAGRAM', type: 'POST' },
      }),
    );
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.publishedContent.deleteMany({ where: { originalUrl: { contains: tag } } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId: { in: [brandId, otherBrandId] } } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId: { in: [brandId, otherBrandId] } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: [brandId, otherBrandId] } } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { id: { in: [influencerId, otherInfluencerId] } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('SCENARIO A — influencer-only content: no campaign required (Critical Question 1)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: auth,
      payload: { url: freshUrl(), influencerId },
    });
    expect(res.statusCode).toBe(201);
    const dto = res.json() as PublishedContentDTO;
    expect(dto.influencer?.id).toBe(influencerId);
    expect(dto.campaign).toBeNull();
  });

  it('SCENARIO B — fully unassigned content is valid, and later resolvable without a duplicate (Critical Question 2)', async () => {
    const url = freshUrl();
    const created = (await app.inject({ method: 'POST', url: '/api/v1/content', headers: auth, payload: { url } })).json() as PublishedContentDTO;
    expect(created.influencer).toBeNull();
    expect(created.campaign).toBeNull();

    const resolved = (
      await app.inject({ method: 'PATCH', url: `/api/v1/content/${created.id}`, headers: auth, payload: { influencerId } })
    ).json() as PublishedContentDTO;
    expect(resolved.id).toBe(created.id); // same record — no duplicate content created
    expect(resolved.influencer?.id).toBe(influencerId);
  });

  it('SCENARIO C — deliverable-anchored content derives influencer/campaign/brand automatically, no repeated selectors', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: auth,
      payload: { url: freshUrl(), deliverableId },
    });
    expect(res.statusCode).toBe(201);
    const dto = res.json() as PublishedContentDTO;
    expect(dto.influencer?.id).toBe(influencerId);
    expect(dto.campaign?.id).toBe(campaignId);
    expect(dto.brand?.id).toBe(brandId);
    expect(dto.deliverable?.id).toBe(deliverableId);

    // The deliverable itself advances to PUBLISHED as a side effect.
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    const d = await prisma.deliverable.findUnique({ where: { id: deliverableId } });
    await prisma.$disconnect();
    expect(d?.status).toBe('PUBLISHED');
  });

  it('SCENARIO E — campaign + influencer not on that roster together is rejected, never silently mismatched', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: auth,
      payload: { url: freshUrl(), campaignId, influencerId: otherInfluencerId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('SCENARIO F — an explicit campaign/influencer that contradicts the deliverable is rejected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: auth,
      payload: { url: freshUrl(), deliverableId, influencerId: otherInfluencerId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('a deliverable belonging to a different campaign entirely: rejected outright', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: auth,
      payload: { url: freshUrl(), campaignId, deliverableId: otherDeliverableId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('SCENARIO G — reassigning content to a deliverable reconciles ALL derived ids, no stale campaignInfluencerId/brandId', async () => {
    // Start fully unassigned.
    const created = (await app.inject({ method: 'POST', url: '/api/v1/content', headers: auth, payload: { url: freshUrl() } })).json() as PublishedContentDTO;
    expect(created.campaign).toBeNull();

    // Reassign directly to the deliverable — influencer/campaign/brand must
    // all update together, derived fresh, not left over from the unassigned state.
    const reassigned = (
      await app.inject({ method: 'PATCH', url: `/api/v1/content/${created.id}`, headers: auth, payload: { deliverableId } })
    ).json() as PublishedContentDTO;
    expect(reassigned.influencer?.id).toBe(influencerId);
    expect(reassigned.campaign?.id).toBe(campaignId);
    expect(reassigned.brand?.id).toBe(brandId);
    expect(reassigned.deliverable?.id).toBe(deliverableId);

    // Now clear the campaign (and therefore the deliverable link) — brandId
    // must be cleared too, not left stale pointing at the old brand.
    const cleared = (
      await app.inject({ method: 'PATCH', url: `/api/v1/content/${created.id}`, headers: auth, payload: { campaignId: null } })
    ).json() as PublishedContentDTO;
    expect(cleared.campaign).toBeNull();
    expect(cleared.brand).toBeNull(); // no stale brandId after the campaign is cleared
    // influencer is untouched by clearing only campaignId
    expect(cleared.influencer?.id).toBe(influencerId);
  });

  it("Activity — GET /activity?publishedContentId= surfaces this content's own ActivityLog history (published + association changes), scoped away from another content's", async () => {
    const created = (
      await app.inject({ method: 'POST', url: '/api/v1/content', headers: auth, payload: { url: freshUrl(), deliverableId } })
    ).json() as PublishedContentDTO;
    // Reassigning associations (SCENARIO G's move) also logs a GENERIC activity row.
    await app.inject({ method: 'PATCH', url: `/api/v1/content/${created.id}`, headers: auth, payload: { campaignId: null } });

    const other = (await app.inject({ method: 'POST', url: '/api/v1/content', headers: auth, payload: { url: freshUrl() } })).json() as PublishedContentDTO;

    const feed = (
      await app.inject({ method: 'GET', url: `/api/v1/activity?publishedContentId=${created.id}`, headers: auth })
    ).json() as { data: { id: string; type: string; message: string }[] };
    expect(feed.data.length).toBeGreaterThanOrEqual(2); // CONTENT_PUBLISHED + the association-change GENERIC row
    expect(feed.data.some((a) => a.type === 'CONTENT_PUBLISHED')).toBe(true);
    expect(feed.data.some((a) => /updated this content's associations/.test(a.message))).toBe(true);

    // A different content item's own creation event must never leak in.
    const otherFeed = (
      await app.inject({ method: 'GET', url: `/api/v1/activity?publishedContentId=${other.id}`, headers: auth })
    ).json() as { data: { id: string }[] };
    expect(otherFeed.data.length).toBeGreaterThan(0);
    expect(otherFeed.data.every((a) => feed.data.every((x) => x.id !== a.id))).toBe(true);
  });

  it('Quick Add / global feed surfaces unassigned content distinctly (no fabricated creator)', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/v1/content', headers: auth, payload: { url: freshUrl() } })).json() as PublishedContentDTO;
    const feed = (
      await app.inject({ method: 'GET', url: `/api/v1/content/feed?assignment=UNASSIGNED&brandId=${brandId}`, headers: auth })
    ).json() as { data: PublishedContentDTO[] };
    // brandId filter won't match a brandless row, so just confirm the general
    // unassigned filter (no brand scoping) surfaces this exact record.
    const generalFeed = (
      await app.inject({ method: 'GET', url: `/api/v1/content/feed?assignment=UNASSIGNED&q=${tag}`, headers: auth })
    ).json() as { data: PublishedContentDTO[] };
    expect(generalFeed.data.some((c) => c.id === created.id)).toBe(true);
    expect(feed.data.every((c) => c.influencer == null && c.campaign == null)).toBe(true);
  });
});
