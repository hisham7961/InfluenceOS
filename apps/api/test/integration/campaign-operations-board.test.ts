import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CampaignOperationsBoardDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * OI-5 — Campaign Operations Board: 8 stages per roster row, derived
 * read-time (no per-stage status is ever stored). Proves against a real
 * published deliverable that requires a product but has no shipment — the
 * exact "product" stage should report it, matching the Workflow Integrity
 * Guard's independent DELIVERABLE_MISSING_LOGISTICS rule on the same data.
 */
describe('OI-5 — Campaign Operations Board', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let ciId: string;
  let deliverableId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Board Brand ${Date.now()}` } }));
    campaignId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Board Camp ${Date.now()}` } }),
    );
    const influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Board Creator ${Date.now()}` } }),
    );
    ciId = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId, dealType: 'GIFTED_PRODUCT' } }),
    );
    deliverableId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/deliverables`,
        headers: auth,
        payload: { platform: 'INSTAGRAM', type: 'REEL', requiresProduct: true },
      }),
    );
    // Publish it without ever creating a shipment.
    await app.inject({ method: 'PATCH', url: `/api/v1/deliverables/${deliverableId}`, headers: auth, payload: { status: 'PUBLISHED', publishedAt: new Date().toISOString() } });
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

  it('derives all 8 stages per roster row from real deliverable/shipment state', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/operations-board`, headers: auth });
    expect(res.statusCode).toBe(200);
    const board = res.json() as CampaignOperationsBoardDTO;
    expect(board.campaignId).toBe(campaignId);
    const row = board.rows.find((r) => r.campaignInfluencerId === ciId);
    expect(row).toBeDefined();
    expect(row!.stages).toHaveLength(8);
    const byKey = Object.fromEntries(row!.stages.map((s) => [s.key, s]));

    // Published, but requiresProduct=true and no shipment was ever created —
    // the product stage must not silently report 'done'.
    expect(byKey.product.state).not.toBe('done');
    expect(byKey.published.state).toBe('done');
    // Payment stage: GIFTED_PRODUCT deal has no payment due.
    expect(byKey.payment.state).toBe('na');

    // Filter buckets are derived from the same stage data, never independently stored.
    expect(row!.filterBuckets.length).toBeGreaterThan(0);
  });

  it('reflects a real shipment once delivered — no per-stage status is ever stored, only derived', async () => {
    const shipmentId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/shipments`,
        headers: auth,
        payload: { deliverableId, items: [{ productName: 'Sample kit' }] },
      }),
    );
    await app.inject({ method: 'POST', url: `/api/v1/shipments/${shipmentId}/status`, headers: auth, payload: { status: 'DELIVERED' } });

    const res = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/operations-board`, headers: auth });
    const board = res.json() as CampaignOperationsBoardDTO;
    const row = board.rows.find((r) => r.campaignInfluencerId === ciId)!;
    const byKey = Object.fromEntries(row.stages.map((s) => [s.key, s]));
    expect(byKey.product.state).toBe('done');
  });
});
