import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { IntegrityFindingDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * OI-9 — Workflow Integrity Guard: a read-only relational-consistency sweep.
 * Covers two of the seven rules end to end against a real database (the
 * financial one and the campaign/deliverable one), and proves findings are
 * derived at read time — fixing the underlying row makes the finding
 * disappear on the next call, with nothing stored anywhere.
 */
describe('OI-9 — Workflow Integrity Guard', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let otherBrandId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Integrity Brand ${Date.now()}` } }));
    otherBrandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Integrity Other Brand ${Date.now()}` } }));
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId: { in: [brandId, otherBrandId] } } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: otherBrandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  async function findingsFor(scopeBrandId: string): Promise<IntegrityFindingDTO[]> {
    const res = await app.inject({ method: 'GET', url: `/api/v1/integrity/findings?brandId=${scopeBrandId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    return res.json() as IntegrityFindingDTO[];
  }

  it('flags a paid amount that exceeds the agreed cost, and clears once corrected', async () => {
    const campaignId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Overpaid Camp ${Date.now()}` } }),
    );
    const influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Overpaid Inf ${Date.now()}`, countryCode: 'KW' } }),
    );
    const ciId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/influencers`,
        headers: auth,
        payload: { influencerId, dealType: 'PAID', agreedCost: 100, paidAmount: 150 },
      }),
    );

    const findings = await findingsFor(brandId);
    const finding = findings.find((f) => f.rule === 'PAID_AMOUNT_EXCEEDS_AGREED_COST' && f.id === `PAID_AMOUNT_EXCEEDS_AGREED_COST:${ciId}`);
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('error');
    expect(finding!.evidence).toContain('100');
    expect(finding!.evidence).toContain('150');

    // Out-of-scope for a different brand — never leaks across brands.
    const otherScoped = await findingsFor(otherBrandId);
    expect(otherScoped.find((f) => f.id === finding!.id)).toBeUndefined();

    // Correcting the row makes the finding disappear on the next read — it
    // was never stored, only derived.
    await app.inject({ method: 'PATCH', url: `/api/v1/campaign-influencers/${ciId}`, headers: auth, payload: { paidAmount: 100 } });
    const after = await findingsFor(brandId);
    expect(after.find((f) => f.id === finding!.id)).toBeUndefined();
  });

  it('flags a completed campaign that still has an open deliverable', async () => {
    const campaignId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Stale Complete Camp ${Date.now()}` } }),
    );
    const influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Stale Complete Inf ${Date.now()}`, countryCode: 'KW' } }),
    );
    const ciId = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId } }),
    );
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/deliverables`,
      headers: auth,
      payload: { platform: 'INSTAGRAM', type: 'REEL' }, // defaults to status PLANNED — still open
    });

    // Not flagged while the campaign is still active.
    const beforeComplete = await findingsFor(brandId);
    expect(beforeComplete.find((f) => f.rule === 'CAMPAIGN_COMPLETED_WITH_OVERDUE_DELIVERABLES' && f.id.endsWith(campaignId))).toBeUndefined();

    await app.inject({ method: 'PATCH', url: `/api/v1/campaigns/${campaignId}`, headers: auth, payload: { status: 'COMPLETED' } });

    const findings = await findingsFor(brandId);
    const finding = findings.find((f) => f.rule === 'CAMPAIGN_COMPLETED_WITH_OVERDUE_DELIVERABLES' && f.id === `CAMPAIGN_COMPLETED_WITH_OVERDUE_DELIVERABLES:${campaignId}`);
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
    expect(finding!.link).toBe(`/campaigns/${campaignId}`);
  });
});
