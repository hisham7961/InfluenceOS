import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProductShipmentDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Logistics fulfilment requests (evolved from W3-5's one-shipment-per-gift-
 * record shape — docs/workflow/WORKFLOW_GAP_MATRIX.md). A CampaignInfluencer
 * may now have SEVERAL independent shipments; each is keyed by its own id;
 * reaching SHIPPED/DELIVERED stamps the matching timestamp automatically.
 */
describe('Logistics — shipment tracking (evolved W3-5)', () => {
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
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Ship Brand ${Date.now()}` } }));
    influencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Ship Inf ${Date.now()}`, countryCode: 'KW' } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Ship Camp ${Date.now()}` } }));
    ciId = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId, dealType: 'GIFTED_PRODUCT', giftedProductValue: 40, currency: 'KWD' } }));
    deliverableId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/deliverables`,
        headers: auth,
        payload: { platform: 'INSTAGRAM', type: 'UGC', requiresProduct: true },
      }),
    );
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

  it('has no shipments until one is created', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/campaign-influencers/${ciId}/shipments`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('deliverable.requiresProduct persists as set at creation', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/deliverables/${deliverableId}`, headers: auth, payload: {} });
    expect((res.json() as { requiresProduct: boolean }).requiresProduct).toBe(true);
  });

  let firstShipmentId: string;

  it('creates a shipment (PENDING) linked to a deliverable, with product line items', async () => {
    const created = (await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/shipments`,
      headers: auth,
      payload: {
        deliverableId,
        recipientName: 'Sara',
        addressLine1: '10 Gulf Rd',
        city: 'Kuwait City',
        country: 'KW',
        courier: 'Aramex',
        items: [
          { productName: 'Toner', quantity: 1 },
          { productName: 'SPF 50', sku: 'SPF-50', quantity: 2 },
        ],
      },
    })).json() as ProductShipmentDTO;
    firstShipmentId = created.id;
    expect(created.status).toBe('PENDING');
    expect(created.campaignInfluencerId).toBe(ciId);
    expect(created.deliverableId).toBe(deliverableId);
    expect(created.recipientName).toBe('Sara');
    expect(created.shippedAt).toBeNull();
    expect(created.items).toHaveLength(2);
    expect(created.items.map((i) => i.productName).sort()).toEqual(['SPF 50', 'Toner']);
    const spf = created.items.find((i) => i.productName === 'SPF 50')!;
    expect(spf.sku).toBe('SPF-50');
    expect(spf.quantity).toBe(2);
  });

  it('rejects a deliverableId that belongs to a different campaign-influencer', async () => {
    const otherInf = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Ship Other ${Date.now()}`, countryCode: 'KW' } }));
    const otherCi = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId: otherInf, dealType: 'FREE' } }));
    const otherDeliverable = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${otherCi}/deliverables`, headers: auth, payload: { platform: 'INSTAGRAM', type: 'UGC' } }),
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/shipments`,
      headers: auth,
      payload: { deliverableId: otherDeliverable },
    });
    expect(res.statusCode).toBe(409);
    await app.inject({ method: 'DELETE', url: `/api/v1/campaign-influencers/${otherCi}`, headers: auth });
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.influencer.delete({ where: { id: otherInf } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('a second shipment for the SAME campaign-influencer is a NEW row, not an upsert (SCENARIO J)', async () => {
    const second = (await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciId}/shipments`,
      headers: auth,
      payload: { recipientName: 'Sara — replacement', items: [{ productName: 'Toner', quantity: 1 }] },
    })).json() as ProductShipmentDTO;
    expect(second.id).not.toBe(firstShipmentId);

    const list = (await app.inject({ method: 'GET', url: `/api/v1/campaign-influencers/${ciId}/shipments`, headers: auth })).json() as ProductShipmentDTO[];
    expect(list).toHaveLength(2);
  });

  it('updates fulfilment details via PATCH /shipments/:id', async () => {
    const updated = (await app.inject({
      method: 'PATCH',
      url: `/api/v1/shipments/${firstShipmentId}`,
      headers: auth,
      payload: { trackingNumber: 'AR123', trackingUrl: 'https://track.aramex.com/AR123' },
    })).json() as ProductShipmentDTO;
    expect(updated.id).toBe(firstShipmentId);
    expect(updated.trackingNumber).toBe('AR123');
  });

  it('rejects an unsafe tracking URL (SEC-01 guard)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/shipments/${firstShipmentId}`, headers: auth,
      payload: { trackingUrl: 'javascript:alert(1)' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('auto-stamps shippedAt on SHIPPED and deliveredAt on DELIVERED', async () => {
    const shipped = (await app.inject({ method: 'POST', url: `/api/v1/shipments/${firstShipmentId}/status`, headers: auth, payload: { status: 'SHIPPED' } })).json() as ProductShipmentDTO;
    expect(shipped.status).toBe('SHIPPED');
    expect(shipped.shippedAt).not.toBeNull();
    expect(shipped.deliveredAt).toBeNull();
    const shippedAt = shipped.shippedAt;

    const delivered = (await app.inject({ method: 'POST', url: `/api/v1/shipments/${firstShipmentId}/status`, headers: auth, payload: { status: 'DELIVERED' } })).json() as ProductShipmentDTO;
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.deliveredAt).not.toBeNull();
    expect(delivered.shippedAt).toBe(shippedAt); // original ship time preserved
  });

  it('shows up in the cross-campaign /shipments (logistics) workspace', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/shipments?status=DELIVERED&brandId=${brandId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: ProductShipmentDTO[] };
    expect(body.data.some((s) => s.id === firstShipmentId)).toBe(true);
  });

  it('cascades away with the campaign-influencer (no orphan shipments)', async () => {
    await app.inject({ method: 'DELETE', url: `/api/v1/campaign-influencers/${ciId}`, headers: auth });
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    const orphans = await prisma.productShipment.findMany({ where: { campaignInfluencerId: ciId } });
    await prisma.$disconnect();
    expect(orphans).toHaveLength(0);
  });
});
