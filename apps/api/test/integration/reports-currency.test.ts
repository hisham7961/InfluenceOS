import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ReportDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W1-5 / DB-03 — a report must never present a sum of different currencies as a
 * single figure. When the scope spans more than one currency the report is
 * labelled 'MIXED' and its money grand totals are suppressed (null) instead of
 * being summed across currencies. A single-currency scope still totals normally.
 */
describe('DB-03 — reports do not sum across currencies', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let adminId: string;
  let brandId: string;
  let influencerId: string;
  let campaignKwdId: string;
  let campaignUsdId: string;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    adminId = a.userId;

    const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Ccy Brand ${Date.now()}` } }));
    influencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Ccy Inf ${Date.now()}` } }));

    campaignKwdId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `KWD Camp ${Date.now()}`, currency: 'KWD' } }));
    campaignUsdId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `USD Camp ${Date.now()}`, currency: 'USD' } }));

    // Give each campaign some spend (a PAID influencer fee in the campaign's currency).
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignKwdId}/influencers`, headers: auth, payload: { influencerId, dealType: 'PAID', agreedCost: 1000, currency: 'KWD' } });
    await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignUsdId}/influencers`, headers: auth, payload: { influencerId, dealType: 'PAID', agreedCost: 500, currency: 'USD' } });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaignInfluencer.deleteMany({ where: { campaignId: { in: [campaignKwdId, campaignUsdId] } } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { id: { in: [campaignKwdId, campaignUsdId] } } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
  });

  async function report(query: string): Promise<ReportDTO> {
    const res = await app.inject({ method: 'GET', url: `/api/v1/reports?${query}`, headers: auth });
    expect(res.statusCode).toBe(200);
    return res.json() as ReportDTO;
  }

  it('a mixed-currency (KWD+USD) spend report is labelled MIXED with suppressed money totals', async () => {
    const r = await report(`type=spend&brandId=${brandId}`);
    expect(r.currency).toBe('MIXED');
    // The money grand totals must NOT be a single number summed across currencies.
    expect(r.totals?.spend ?? null).toBeNull();
    expect(r.totals?.budget ?? null).toBeNull();
  });

  it('a single-currency spend report totals normally', async () => {
    const r = await report(`type=spend&campaignId=${campaignKwdId}`);
    expect(r.currency).toBe('KWD');
    expect(typeof r.totals?.spend).toBe('number');
  });

  it('a mixed-currency campaign report is also MIXED with suppressed spend total', async () => {
    const r = await report(`type=campaign&brandId=${brandId}`);
    expect(r.currency).toBe('MIXED');
    expect(r.totals?.spend ?? null).toBeNull();
  });
});
