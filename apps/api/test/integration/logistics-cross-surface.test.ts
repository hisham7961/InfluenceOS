import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AttentionItemDTO, CampaignOperationsBoardDTO, CreatorSnapshotDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Advanced Roles & Logistics Operations pass — cross-surface visibility. ONE
 * LogisticsIssue record must appear on Logistics (already tested elsewhere),
 * Influencer 360 (warning banner data), the Campaign Operations Board (a
 * Product-stage blocker, not a second campaign-logistics state), and the
 * canonical Needs Attention feed — never a copy, never duplicated logic.
 */
describe('Advanced Roles — cross-surface logistics issue visibility', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let brandId: string;
  let campaignId: string;
  let influencerId: string;
  let shipmentId: string;
  let issueId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `CrossSurface Brand ${Date.now()}` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId, name: `CrossSurface Camp ${Date.now()}` } }));
    influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `CrossSurface Creator ${Date.now()}`, countryCode: 'KW' } }),
    );
    const ciId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/influencers`,
        headers: admin,
        payload: { influencerId, dealType: 'GIFTED_PRODUCT' },
      }),
    );
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/deliverables`,
      headers: admin,
      payload: { platform: 'INSTAGRAM', type: 'UGC', requiresProduct: true },
    });
    shipmentId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/shipments`,
        headers: admin,
        payload: { recipientName: 'Cross Recipient', phone: '+96550000001', city: 'Kuwait City', destinationCountryCode: 'KW', items: [{ productName: 'Kit' }] },
      }),
    );
    issueId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/shipments/${shipmentId}/issues`,
        headers: admin,
        payload: { type: 'UNCLEAR_ADDRESS', description: 'Building number 12B on Street 45 is hard to find — please confirm.' },
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
    await deleteUser(adminId);
  });

  it('appears on Influencer 360 as an open logistics issue with the current shipment attached', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/snapshot`, headers: admin });
    expect(res.statusCode).toBe(200);
    const snapshot = res.json() as CreatorSnapshotDTO;
    expect(snapshot.openLogisticsIssues).toHaveLength(1);
    expect(snapshot.openLogisticsIssues[0]!.shipmentId).toBe(shipmentId);
    expect(snapshot.openLogisticsIssues[0]!.type).toBe('UNCLEAR_ADDRESS');
    expect(snapshot.mostRecentShipment?.id).toBe(shipmentId);
    expect(snapshot.mostRecentShipment?.destinationCountryCode).toBe('KW');
  });

  it('blocks the Product stage on the Campaign Operations Board — a blocker, not a duplicate state', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/operations-board`, headers: admin });
    expect(res.statusCode).toBe(200);
    const board = res.json() as CampaignOperationsBoardDTO;
    const row = board.rows.find((r) => r.influencerId === influencerId);
    expect(row).toBeDefined();
    const product = row!.stages.find((s) => s.key === 'product');
    expect(product?.state).toBe('overdue');
    expect(product?.detail).toContain('Address Clarification');
    expect(row!.filterBuckets).toContain('needsAttention');
  });

  it('shows up on the canonical Needs Attention feed, without leaking the free-text address into the description', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/dashboard/attention?brandId=${brandId}`, headers: admin });
    expect(res.statusCode).toBe(200);
    const items = res.json() as AttentionItemDTO[];
    const mine = items.find((i) => i.id === `logistics-issue-${issueId}`);
    expect(mine).toBeDefined();
    expect(mine!.kind).toBe('LOGISTICS_ADDRESS_ISSUE');
    expect(mine!.description).not.toContain('Street 45');
    expect(mine!.description).not.toContain('12B');
  });

  it('clears from the Operations Board blocker and Needs Attention once resolved — the SAME record, not a copy left behind', async () => {
    await app.inject({ method: 'PATCH', url: `/api/v1/shipments/${shipmentId}`, headers: admin, payload: { addressLine1: 'Street 45, Building 12B, Floor 2' } });
    const resolve = await app.inject({ method: 'POST', url: `/api/v1/logistics-issues/${issueId}/resolve`, headers: admin });
    expect(resolve.statusCode).toBe(200);

    const boardRes = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/operations-board`, headers: admin });
    const board = boardRes.json() as CampaignOperationsBoardDTO;
    const row = board.rows.find((r) => r.influencerId === influencerId);
    const product = row!.stages.find((s) => s.key === 'product');
    expect(product?.detail).not.toContain('Address Clarification');

    const attentionRes = await app.inject({ method: 'GET', url: `/api/v1/dashboard/attention?brandId=${brandId}`, headers: admin });
    const items = attentionRes.json() as AttentionItemDTO[];
    expect(items.some((i) => i.id === `logistics-issue-${issueId}`)).toBe(false);

    const snapshotRes = await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/snapshot`, headers: admin });
    const snapshot = snapshotRes.json() as CreatorSnapshotDTO;
    expect(snapshot.openLogisticsIssues).toHaveLength(0);
  });
});
