import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CampaignInfluencerDTO, DeliverableSubmissionDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W3-1 — content review/approval + revision workflow, and a UGC deliverable that
 * completes via approval WITHOUT any public social URL. Draft → comment →
 * request-changes → new revision → approve; the deliverable then counts as
 * complete in the campaign-influencer's progress.
 */
describe('W3-1 — deliverable submission review/approval + UGC completion', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let influencerId: string;
  let campaignId: string;
  let ciId: string;
  let deliverableId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `UGC Brand ${Date.now()}` } }));
    influencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `UGC Inf ${Date.now()}`, countryCode: 'KW' } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `UGC Camp ${Date.now()}` } }));
    ciId = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId, dealType: 'FREE' } }));
    // A UGC deliverable: an owned asset with no public post.
    deliverableId = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ciId}/deliverables`, headers: auth, payload: { platform: 'INSTAGRAM', type: 'UGC' } }));
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('runs the full review lifecycle and completes a UGC deliverable without a public URL', async () => {
    // 1. Submit draft v1 → deliverable goes IN_REVIEW.
    const v1res = await app.inject({
      method: 'POST',
      url: `/api/v1/deliverables/${deliverableId}/submissions`,
      headers: auth,
      payload: { notes: 'first cut', assetUrl: 'https://drive.example.com/asset-v1' },
    });
    expect(v1res.statusCode).toBe(201);
    const v1 = v1res.json() as DeliverableSubmissionDTO;
    expect(v1.version).toBe(1);
    expect(v1.status).toBe('IN_REVIEW');

    // rejecting a bad scheme on the asset URL (SEC-01 guard still applies).
    const badUrl = await app.inject({
      method: 'POST',
      url: `/api/v1/deliverables/${deliverableId}/submissions`,
      headers: auth,
      payload: { assetUrl: 'javascript:alert(1)' },
    });
    expect(badUrl.statusCode).toBe(422);

    // 2. A review comment.
    const commented = await app.inject({ method: 'POST', url: `/api/v1/submissions/${v1.id}/comments`, headers: auth, payload: { body: 'tighten the intro' } });
    expect(commented.statusCode).toBe(201);
    expect((commented.json() as DeliverableSubmissionDTO).comments).toHaveLength(1);

    // 3. Request changes → submission + deliverable go CHANGES_REQUESTED.
    const changes = await app.inject({ method: 'POST', url: `/api/v1/submissions/${v1.id}/review`, headers: auth, payload: { decision: 'REQUEST_CHANGES', note: 'see comment' } });
    expect((changes.json() as DeliverableSubmissionDTO).status).toBe('CHANGES_REQUESTED');

    // 4. Submit revision v2.
    const v2 = (await app.inject({ method: 'POST', url: `/api/v1/deliverables/${deliverableId}/submissions`, headers: auth, payload: { notes: 'revised' } })).json() as DeliverableSubmissionDTO;
    expect(v2.version).toBe(2);

    // 5. Approve v2 → submission APPROVED; auditable reviewer recorded.
    const approved = (await app.inject({ method: 'POST', url: `/api/v1/submissions/${v2.id}/review`, headers: auth, payload: { decision: 'APPROVE' } })).json() as DeliverableSubmissionDTO;
    expect(approved.status).toBe('APPROVED');
    expect(approved.reviewedByName).not.toBeNull();
    expect(approved.reviewedAt).not.toBeNull();

    // Re-approving an approved submission is refused.
    expect((await app.inject({ method: 'POST', url: `/api/v1/submissions/${v2.id}/review`, headers: auth, payload: { decision: 'APPROVE' } })).statusCode).toBe(400);

    // 6. The UGC deliverable now counts as complete — WITHOUT any public URL.
    const ci = (await app.inject({ method: 'GET', url: `/api/v1/campaign-influencers/${ciId}`, headers: auth })).json() as CampaignInfluencerDTO;
    const del = ci.deliverables.find((d) => d.id === deliverableId)!;
    expect(del.status).toBe('APPROVED');
    expect(del.publishedUrl).toBeNull(); // no public social URL, yet complete
    expect(ci.deliverableProgress.published).toBe(1);

    // 7. Two submissions on record (the revision history / approval trail).
    const list = (await app.inject({ method: 'GET', url: `/api/v1/deliverables/${deliverableId}/submissions`, headers: auth })).json() as DeliverableSubmissionDTO[];
    expect(list.map((s) => s.version)).toEqual([1, 2]);
    expect(list[1]?.status).toBe('APPROVED');
  });
});
