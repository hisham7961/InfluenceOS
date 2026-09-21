import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProductShipmentDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W3-5 (web surface) — the campaign-level shipments endpoint returns every
 * product shipment across the roster in one query, so the workspace can answer
 * "did the gifts arrive?" without a per-creator fan-out.
 */
describe('W3-5 — campaign roster shipments', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let ciId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Ship Brand ${Date.now()}` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Ship Camp ${Date.now()}` } }));
    const inf = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Ship Inf ${Date.now()}`, countryCode: 'KW' } }));
    ciId = idOf(await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignId}/influencers`, headers: auth, payload: { influencerId: inf, dealType: 'FREE' } }));
    // A gift shipment marked SHIPPED — reaching SHIPPED auto-stamps shippedAt.
    await app.inject({
      method: 'POST', url: `/api/v1/campaign-influencers/${ciId}/shipments`, headers: auth,
      payload: { recipientName: 'Test Recipient', city: 'Kuwait City', country: 'Kuwait', courier: 'Aramex', trackingNumber: 'TRK123', status: 'SHIPPED' },
    });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { displayName: { contains: 'Ship Inf ' } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('lists the campaign roster shipments with status and auto-stamped shippedAt', async () => {
    const list = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/shipments`, headers: auth })).json() as ProductShipmentDTO[];
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(1);
    const s = list[0]!;
    expect(s.campaignInfluencerId).toBe(ciId);
    expect(s.recipientName).toBe('Test Recipient');
    expect(s.courier).toBe('Aramex');
    expect(s.trackingNumber).toBe('TRK123');
    expect(s.status).toBe('SHIPPED');
    expect(typeof s.shippedAt).toBe('string'); // auto-stamped on reaching SHIPPED
  });

  it('returns an empty array for a campaign with no shipments', async () => {
    const empty = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Ship Empty ${Date.now()}` } }));
    const list = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${empty}/shipments`, headers: auth })).json() as ProductShipmentDTO[];
    expect(list).toEqual([]);
  });
});
