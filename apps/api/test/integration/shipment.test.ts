import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProductShipmentDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W3-5 — product-seeding shipment tracking on a gift record. Address + courier +
 * tracking + delivery state live 1:1 on a campaign-influencer, and reaching
 * SHIPPED/DELIVERED stamps the matching timestamp automatically.
 */
describe('W3-5 — product shipment tracking', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let influencerId: string;
  let campaignId: string;
  let ciId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Ship Brand ${Date.now()}` } }));
    influencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Ship Inf ${Date.now()}` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Ship Camp ${Date.now()}` } }));
    ciId = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId, dealType: 'GIFTED_PRODUCT', giftedProductValue: 40, currency: 'KWD' } }));
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

  it('has no shipment until one is created', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/campaign-influencers/${ciId}/shipment`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('creates a shipment (PENDING) then updates the address idempotently (still one row)', async () => {
    const created = (await app.inject({
      method: 'PUT', url: `/api/v1/campaign-influencers/${ciId}/shipment`, headers: auth,
      payload: { recipientName: 'Sara', addressLine1: '10 Gulf Rd', city: 'Kuwait City', country: 'KW', courier: 'Aramex' },
    })).json() as ProductShipmentDTO;
    expect(created.status).toBe('PENDING');
    expect(created.recipientName).toBe('Sara');
    expect(created.shippedAt).toBeNull();

    const firstId = created.id;
    const updated = (await app.inject({
      method: 'PUT', url: `/api/v1/campaign-influencers/${ciId}/shipment`, headers: auth,
      payload: { recipientName: 'Sara A.', addressLine1: '10 Gulf Rd', city: 'Kuwait City', country: 'KW', courier: 'Aramex', trackingNumber: 'AR123', trackingUrl: 'https://track.aramex.com/AR123' },
    })).json() as ProductShipmentDTO;
    expect(updated.id).toBe(firstId); // upsert, not a second row
    expect(updated.trackingNumber).toBe('AR123');
  });

  it('rejects an unsafe tracking URL (SEC-01 guard)', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/api/v1/campaign-influencers/${ciId}/shipment`, headers: auth,
      payload: { trackingUrl: 'javascript:alert(1)' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('auto-stamps shippedAt on SHIPPED and deliveredAt on DELIVERED', async () => {
    const shipped = (await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ciId}/shipment/status`, headers: auth, payload: { status: 'SHIPPED' } })).json() as ProductShipmentDTO;
    expect(shipped.status).toBe('SHIPPED');
    expect(shipped.shippedAt).not.toBeNull();
    expect(shipped.deliveredAt).toBeNull();
    const shippedAt = shipped.shippedAt;

    const delivered = (await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ciId}/shipment/status`, headers: auth, payload: { status: 'DELIVERED' } })).json() as ProductShipmentDTO;
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.deliveredAt).not.toBeNull();
    expect(delivered.shippedAt).toBe(shippedAt); // original ship time preserved
  });

  it('cascades away with the campaign-influencer (no orphan shipment)', async () => {
    await app.inject({ method: 'DELETE', url: `/api/v1/campaign-influencers/${ciId}`, headers: auth });
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    const orphan = await prisma.productShipment.findUnique({ where: { campaignInfluencerId: ciId } });
    await prisma.$disconnect();
    expect(orphan).toBeNull();
  });
});
