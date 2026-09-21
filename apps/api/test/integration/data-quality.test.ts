import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DataQualityReportDTO, DuplicateCandidateDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * OI-6 — Data Quality + Duplicate Detection: findings are real, brand-scoped
 * aggregate counts of rows matching a real condition (never a fabricated
 * score), and duplicate candidates carry the exact field/value that matched
 * so a human can judge for themselves. Proves both against a real,
 * intentionally-incomplete roster row and a real shared-email pair.
 */
describe('OI-6 — Data Quality + Duplicate Detection', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `DQ Brand ${Date.now()}` } }));
    campaignId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        headers: auth,
        payload: { brandId, name: `DQ Camp ${Date.now()}`, status: 'PLANNING' },
      }),
    );

    // One roster row, deliberately missing every field the report() findings
    // check for: no social accounts, no contact info, no category, a PAID
    // deal with no agreedCost, and a deliverable with no dueDate.
    const influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `DQ Creator ${Date.now()}` } }),
    );
    const ciId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/influencers`,
        headers: auth,
        payload: { influencerId, dealType: 'PAID' },
      }),
    );
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/deliverables`,
      headers: auth,
      payload: { platform: 'INSTAGRAM', type: 'REEL' },
    });
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

  it('report() derives real counts of missing/incomplete data, scoped to the brand', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/data-quality/report?brandId=${brandId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const report = res.json() as DataQualityReportDTO;
    const byId = Object.fromEntries(report.findings.map((f) => [f.id, f]));

    expect(byId['influencer-no-social'].count).toBe(1);
    expect(byId['influencer-no-contact'].count).toBe(1);
    expect(byId['influencer-no-category'].count).toBe(1);
    // A single PAID deal with no agreedCost.
    expect(byId['paid-deal-no-cost'].count).toBe(1);
    // The campaign itself is PLANNING (an open status) with no plannedBudget.
    expect(byId['campaign-no-budget'].count).toBe(1);
    // The one deliverable created above has no dueDate and is still PLANNED (active).
    expect(byId['deliverable-no-due-date'].count).toBe(1);
  });

  it('duplicates() surfaces a real exact match on a shared email, with the matching field/value shown', async () => {
    const email = `dup-${Date.now()}@example.com`;
    const id1 = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: 'Dup Creator One', email } }),
    );
    const id2 = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: 'Dup Creator Two', email } }),
    );
    // Both must join this brand's roster to be in the brand-scoped result.
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/influencers`,
      headers: auth,
      payload: { influencerId: id1, dealType: 'GIFTED_PRODUCT' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/influencers`,
      headers: auth,
      payload: { influencerId: id2, dealType: 'GIFTED_PRODUCT' },
    });

    const res = await app.inject({ method: 'GET', url: `/api/v1/data-quality/duplicates?brandId=${brandId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const candidates = res.json() as DuplicateCandidateDTO[];
    const matched = candidates.filter((c) => c.influencerId === id1 || c.influencerId === id2);
    expect(matched).toHaveLength(2);
    for (const c of matched) {
      expect(c.confidence).toBe('exact');
      expect(c.reasons.some((r) => r.field === 'email' && r.value === email)).toBe(true);
    }
  });

  it('duplicates() is brand-scoped — an out-of-scope brandId yields no results, never a silent fallback to full scope', async () => {
    const otherBrandId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `DQ Other Brand ${Date.now()}` } }),
    );
    const res = await app.inject({ method: 'GET', url: `/api/v1/data-quality/duplicates?brandId=${otherBrandId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const candidates = res.json() as DuplicateCandidateDTO[];
    expect(candidates).toHaveLength(0);

    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.brand.delete({ where: { id: otherBrandId } }).catch(() => undefined);
    await prisma.$disconnect();
  });
});
