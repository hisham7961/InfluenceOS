import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AttentionItemDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * OI-8 — the ONE canonical operational-attention source (dashboard.service.ts's
 * attention()) that Mission Control, the Campaign/Creator contextual views
 * and the Operations page all render a filtered slice of, never a second
 * calculation. Proves two of its real sources (an overdue deliverable, a
 * campaign ending soon) against real rows, plus brand-scope isolation.
 */
describe('OI-8 — Needs Attention canonical service', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let deliverableId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const day = 864e5;
  const daysFromNow = (n: number) => new Date(Date.now() + n * day).toISOString();
  const daysAgo = (n: number) => new Date(Date.now() - n * day).toISOString();

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Attention Brand ${Date.now()}` } }));
    campaignId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        headers: auth,
        payload: { brandId, name: `Attention Camp ${Date.now()}`, status: 'ACTIVE', endDate: daysFromNow(3) },
      }),
    );
    const influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Attention Creator ${Date.now()}` } }),
    );
    const ciId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/influencers`,
        headers: auth,
        payload: { influencerId, dealType: 'GIFTED_PRODUCT' },
      }),
    );
    // Still PLANNED (an open status) with a dueDate in the past — overdue.
    deliverableId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/deliverables`,
        headers: auth,
        payload: { platform: 'INSTAGRAM', type: 'REEL', dueDate: daysAgo(2) },
      }),
    );
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

  it('surfaces a real overdue deliverable and a real ending-soon campaign, scoped to the brand', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/dashboard/attention?brandId=${brandId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const items = res.json() as AttentionItemDTO[];

    const overdue = items.find((i) => i.id === `overdue-${deliverableId}`);
    expect(overdue).toBeDefined();
    expect(overdue!.kind).toBe('DELIVERABLE_OVERDUE');
    expect(overdue!.severity).toBe('danger');
    expect(overdue!.campaignId).toBe(campaignId);
    expect(overdue!.brandId).toBe(brandId);
    expect(overdue!.link).toBe(`/campaigns/${campaignId}`);

    const ending = items.find((i) => i.id === `ending-${campaignId}`);
    expect(ending).toBeDefined();
    expect(ending!.kind).toBe('CAMPAIGN_ENDING');
    expect(ending!.severity).toBe('warning');

    // Danger-severity items must sort ahead of warning-severity ones.
    const overdueIdx = items.findIndex((i) => i.id === `overdue-${deliverableId}`);
    const endingIdx = items.findIndex((i) => i.id === `ending-${campaignId}`);
    expect(overdueIdx).toBeLessThan(endingIdx);
  });

  it('is brand-scoped — an unrelated brandId never sees this brand\'s attention items', async () => {
    const otherBrandId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Attention Other Brand ${Date.now()}` } }),
    );
    const res = await app.inject({ method: 'GET', url: `/api/v1/dashboard/attention?brandId=${otherBrandId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const items = res.json() as AttentionItemDTO[];
    expect(items.some((i) => i.id === `overdue-${deliverableId}` || i.id === `ending-${campaignId}`)).toBe(false);

    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.brand.delete({ where: { id: otherBrandId } }).catch(() => undefined);
    await prisma.$disconnect();
  });
});
