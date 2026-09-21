import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CampaignCandidateDTO, CampaignInfluencerDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W3-3 — sourcing / shortlist pipeline. Creators are considered, shortlisted,
 * approved or rejected for a campaign BEFORE any roster commit. The core
 * guarantee (fixes the DB-10 side-effect): evaluating candidates never creates
 * a CampaignInfluencer and never inflates the influencer's collaboration
 * history — only `convert` commits an approved candidate to the roster, and
 * even then the still-INVITED participation counts as zero collaborations.
 */
describe('W3-3 — sourcing/shortlist candidate pipeline', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let infA: string; // will be converted
  let infB: string; // will be rejected
  let infC: string; // stays considering

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  const collaborationsFor = async (influencerId: string): Promise<number> => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    const rel = await prisma.brandInfluencer.findUnique({
      where: { brandId_influencerId: { brandId, influencerId } },
      select: { totalCollaborations: true },
    });
    await prisma.$disconnect();
    return rel?.totalCollaborations ?? -1; // -1 = no relationship row at all
  };

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Src Brand ${Date.now()}` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Src Camp ${Date.now()}` } }));
    infA = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Cand A ${Date.now()}`, countryCode: 'KW' } }));
    infB = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Cand B ${Date.now()}`, countryCode: 'KW' } }));
    infC = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Cand C ${Date.now()}`, countryCode: 'KW' } }));
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    for (const id of [infA, infB, infC]) {
      await prisma.influencer.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('sources candidates without creating a roster or inflating relationship history', async () => {
    // Add three candidates with fit scores.
    const cA = (await app.inject({
      method: 'POST', url: `/api/v1/campaigns/${campaignId}/candidates`, headers: auth,
      payload: { influencerId: infA, fitScore: 90, notes: 'strong fit' },
    }));
    expect(cA.statusCode).toBe(201);
    const candA = cA.json() as CampaignCandidateDTO;
    expect(candA.status).toBe('CONSIDERING');
    expect(candA.fitScore).toBe(90);

    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/candidates`, headers: auth, payload: { influencerId: infB, fitScore: 40 } });
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/candidates`, headers: auth, payload: { influencerId: infC } });

    // Duplicate candidate is refused.
    expect((await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/candidates`, headers: auth, payload: { influencerId: infA } })).statusCode).toBe(409);

    // List is fit-score ranked (desc, nulls last).
    const list = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/candidates`, headers: auth })).json() as CampaignCandidateDTO[];
    expect(list.map((c) => c.influencer.id)).toEqual([infA, infB, infC]);

    // CRITICAL: no roster rows exist yet, and no relationship history was touched.
    const roster = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth })).json() as CampaignInfluencerDTO[];
    expect(roster).toHaveLength(0);
    expect(await collaborationsFor(infA)).toBe(-1); // no BrandInfluencer row created by sourcing
  });

  it('runs the decision flow: shortlist → approve, and reject', async () => {
    const candA = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/candidates`, headers: auth })).json() as CampaignCandidateDTO[];
    const a = candA.find((c) => c.influencer.id === infA)!;
    const b = candA.find((c) => c.influencer.id === infB)!;

    const shortlisted = (await app.inject({ method: 'POST', url: `/api/v1/candidates/${a.id}/decision`, headers: auth, payload: { decision: 'SHORTLIST' } })).json() as CampaignCandidateDTO;
    expect(shortlisted.status).toBe('SHORTLISTED');

    const approved = (await app.inject({ method: 'POST', url: `/api/v1/candidates/${a.id}/decision`, headers: auth, payload: { decision: 'APPROVE', reason: 'great match' } })).json() as CampaignCandidateDTO;
    expect(approved.status).toBe('APPROVED');
    expect(approved.decidedByName).not.toBeNull();
    expect(approved.decidedAt).not.toBeNull();

    const rejected = (await app.inject({ method: 'POST', url: `/api/v1/candidates/${b.id}/decision`, headers: auth, payload: { decision: 'REJECT', reason: 'audience mismatch' } })).json() as CampaignCandidateDTO;
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.decisionReason).toBe('audience mismatch');

    // Still no roster and no inflated history after decisions.
    const roster = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth })).json() as CampaignInfluencerDTO[];
    expect(roster).toHaveLength(0);
  });

  it('refuses to convert a candidate that is only CONSIDERING', async () => {
    const cands = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/candidates`, headers: auth })).json() as CampaignCandidateDTO[];
    const c = cands.find((x) => x.influencer.id === infC)!;
    expect(c.status).toBe('CONSIDERING');
    const res = await app.inject({ method: 'POST', url: `/api/v1/candidates/${c.id}/convert`, headers: auth, payload: { dealType: 'PAID', agreedCost: 100, currency: 'KWD' } });
    expect(res.statusCode).toBe(400);
  });

  it('commits an approved candidate to the roster exactly once (still zero collaborations)', async () => {
    const cands = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/candidates`, headers: auth })).json() as CampaignCandidateDTO[];
    const a = cands.find((x) => x.influencer.id === infA)!;

    const res = await app.inject({ method: 'POST', url: `/api/v1/candidates/${a.id}/convert`, headers: auth, payload: { dealType: 'PAID', agreedCost: 250, currency: 'KWD' } });
    expect(res.statusCode).toBe(201);
    const converted = res.json() as CampaignCandidateDTO;
    expect(converted.status).toBe('CONVERTED');
    expect(converted.convertedCampaignInfluencerId).not.toBeNull();

    // Exactly one roster row now exists, for infA.
    const roster = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth })).json() as CampaignInfluencerDTO[];
    expect(roster).toHaveLength(1);
    expect(roster[0]!.influencer.id).toBe(infA);
    expect(roster[0]!.id).toBe(converted.convertedCampaignInfluencerId);
    expect(roster[0]!.participationStatus).toBe('INVITED');

    // DB-10: a freshly-committed, still-INVITED participation counts as zero
    // collaborations — the relationship row exists but history is not inflated.
    expect(await collaborationsFor(infA)).toBe(0);

    // Re-converting the same candidate is refused.
    expect((await app.inject({ method: 'POST', url: `/api/v1/candidates/${a.id}/convert`, headers: auth, payload: { dealType: 'PAID' } })).statusCode).toBe(400);
    // And it can no longer be decided on.
    expect((await app.inject({ method: 'POST', url: `/api/v1/candidates/${a.id}/decision`, headers: auth, payload: { decision: 'REJECT' } })).statusCode).toBe(400);
  });
});
