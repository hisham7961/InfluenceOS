import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { UsageRightDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * W3-2 — usage-rights (content-licensing) ledger + derived expiry status. A
 * license is recorded under a brand; its `effectiveStatus` is derived at read
 * time (EXPIRING_SOON inside the 14-day window, EXPIRED once past) so ad spend
 * is never planned on rights that have lapsed. Covers create/list/get, the
 * derived status for far-future / near / past / perpetual expiries, update,
 * SEC-01 cross-brand reference rejection, and revoke.
 */
describe('W3-2 — usage-rights ledger + expiry derivation', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let otherBrandId: string;
  let campaignId: string;
  let influencerId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const day = 864e5;
  const inDays = (n: number) => new Date(Date.now() + n * day).toISOString();

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Rights Brand ${Date.now()}` } }));
    otherBrandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `Other Brand ${Date.now()}` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `Rights Camp ${Date.now()}` } }));
    influencerId = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `Rights Inf ${Date.now()}` } }));
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    // UsageRight cascades from the brand; campaigns/influencers cleaned explicitly.
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: otherBrandId } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('records a paid-ads license and derives EXPIRING_SOON inside the window', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/brands/${brandId}/usage-rights`,
      headers: auth,
      payload: {
        campaignId,
        influencerId,
        usageType: 'PAID_ADS',
        territory: 'KW',
        exclusive: true,
        disclosureRequired: true,
        startsAt: inDays(-3),
        expiresAt: inDays(7), // inside the 14-day warning window
        notes: 'Meta + TikTok paid usage',
      },
    });
    expect(res.statusCode).toBe(201);
    const ur = res.json() as UsageRightDTO;
    expect(ur.usageType).toBe('PAID_ADS');
    expect(ur.status).toBe('ACTIVE');
    expect(ur.effectiveStatus).toBe('EXPIRING_SOON');
    expect(ur.daysUntilExpiry).toBeGreaterThan(0);
    expect(ur.daysUntilExpiry).toBeLessThanOrEqual(14);
    expect(ur.exclusive).toBe(true);
    expect(ur.disclosureRequired).toBe(true);
    expect(ur.campaignName).not.toBeNull();
    expect(ur.influencerName).not.toBeNull();
    expect(ur.createdByName).not.toBeNull();
  });

  it('derives ACTIVE (far future), EXPIRED (past), and ACTIVE (perpetual)', async () => {
    const far = (await app.inject({
      method: 'POST', url: `/api/v1/brands/${brandId}/usage-rights`, headers: auth,
      payload: { usageType: 'ORGANIC', expiresAt: inDays(120) },
    })).json() as UsageRightDTO;
    expect(far.effectiveStatus).toBe('ACTIVE');

    const past = (await app.inject({
      method: 'POST', url: `/api/v1/brands/${brandId}/usage-rights`, headers: auth,
      payload: { usageType: 'WHITELISTING', expiresAt: inDays(-1) },
    })).json() as UsageRightDTO;
    // Stored status remains ACTIVE until the worker sweeps it; effective is EXPIRED.
    expect(past.status).toBe('ACTIVE');
    expect(past.effectiveStatus).toBe('EXPIRED');
    expect(past.daysUntilExpiry).toBeLessThan(0);

    const perpetual = (await app.inject({
      method: 'POST', url: `/api/v1/brands/${brandId}/usage-rights`, headers: auth,
      payload: { usageType: 'BROADCAST' },
    })).json() as UsageRightDTO;
    expect(perpetual.expiresAt).toBeNull();
    expect(perpetual.effectiveStatus).toBe('ACTIVE');
    expect(perpetual.daysUntilExpiry).toBeNull();
  });

  it('rejects a campaign that belongs to a different brand (cross-brand guard)', async () => {
    const bad = await app.inject({
      method: 'POST', url: `/api/v1/brands/${otherBrandId}/usage-rights`, headers: auth,
      payload: { campaignId, usageType: 'ORGANIC' }, // campaign belongs to `brandId`
    });
    expect(bad.statusCode).toBe(400);
  });

  it('rejects an unsafe territory length and a bad usageType', async () => {
    const badType = await app.inject({
      method: 'POST', url: `/api/v1/brands/${brandId}/usage-rights`, headers: auth,
      payload: { usageType: 'NOT_A_TYPE' },
    });
    expect(badType.statusCode).toBe(422);
  });

  it('lists a brand\'s rights and fetches one by id', async () => {
    const list = (await app.inject({ method: 'GET', url: `/api/v1/brands/${brandId}/usage-rights`, headers: auth })).json() as UsageRightDTO[];
    expect(list.length).toBeGreaterThanOrEqual(4);
    const first = list[0]!;
    const got = (await app.inject({ method: 'GET', url: `/api/v1/usage-rights/${first.id}`, headers: auth })).json() as UsageRightDTO;
    expect(got.id).toBe(first.id);
  });

  it('updates expiry (ACTIVE→EXPIRING_SOON via PATCH) and then revokes', async () => {
    const created = (await app.inject({
      method: 'POST', url: `/api/v1/brands/${brandId}/usage-rights`, headers: auth,
      payload: { usageType: 'ORGANIC', expiresAt: inDays(120) },
    })).json() as UsageRightDTO;
    expect(created.effectiveStatus).toBe('ACTIVE');

    const patched = (await app.inject({
      method: 'PATCH', url: `/api/v1/usage-rights/${created.id}`, headers: auth,
      payload: { expiresAt: inDays(5), notes: 'shortened window' },
    })).json() as UsageRightDTO;
    expect(patched.effectiveStatus).toBe('EXPIRING_SOON');
    expect(patched.notes).toBe('shortened window');

    const revoked = (await app.inject({ method: 'POST', url: `/api/v1/usage-rights/${created.id}/revoke`, headers: auth })).json() as UsageRightDTO;
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.effectiveStatus).toBe('REVOKED');

    // Revoking again is refused.
    expect((await app.inject({ method: 'POST', url: `/api/v1/usage-rights/${created.id}/revoke`, headers: auth })).statusCode).toBe(400);
  });
});
