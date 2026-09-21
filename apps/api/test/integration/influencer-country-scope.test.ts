import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InfluencerDetailDTO, InfluencerSummaryDTO, Paginated } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Advanced Roles & Logistics Operations pass — country-aware Influencer
 * directory. Filtering (countryCode/city/ownerId) is server-side, and an
 * actor with an explicit UserCountryAccess set can never reach an
 * out-of-scope creator by id, matching the same posture already proven for
 * shipments (logistics-summary.test.ts).
 */
describe('Advanced Roles — Influencer directory country scope', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let kwInfluencerId: string;
  let aeInfluencerId: string;
  let kwUserId: string;
  let kwAuth: Record<string, string>;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    kwInfluencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `KW Creator ${Date.now()}`, countryCode: 'KW' } }),
    );
    await app.inject({ method: 'PATCH', url: `/api/v1/influencers/${kwInfluencerId}`, headers: admin, payload: { city: 'Kuwait City' } });

    aeInfluencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `AE Creator ${Date.now()}`, countryCode: 'AE' } }),
    );
    await app.inject({ method: 'PATCH', url: `/api/v1/influencers/${aeInfluencerId}`, headers: admin, payload: { city: 'Dubai' } });

    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `staff_im_${Date.now()}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({ data: { email, name: 'KW Influencer Manager', role: 'STAFF', passwordHash: await hash(password) } });
    kwUserId = user.id;
    await prisma.$disconnect();
    await app.inject({ method: 'PATCH', url: `/api/v1/users/${kwUserId}`, headers: admin, payload: { roleProfile: 'INFLUENCER_MANAGER' } });
    await app.inject({ method: 'PUT', url: `/api/v1/users/${kwUserId}/country-access`, headers: admin, payload: { countryCodes: ['KW'] } });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    kwAuth = { authorization: `Bearer ${(login.json() as { tokens: { accessToken: string } }).tokens.accessToken}` };
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(adminId);
    await deleteUser(kwUserId);
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.influencer.deleteMany({ where: { id: { in: [kwInfluencerId, aeInfluencerId] } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('server-side filters the directory by countryCode and city — never a client-side post-filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/influencers?countryCode=KW&pageSize=50', headers: admin });
    expect(res.statusCode).toBe(200);
    const page = res.json() as Paginated<InfluencerSummaryDTO>;
    expect(page.data.map((r) => r.id)).toContain(kwInfluencerId);
    expect(page.data.map((r) => r.id)).not.toContain(aeInfluencerId);

    const cityRes = await app.inject({ method: 'GET', url: '/api/v1/influencers?city=Dubai&pageSize=50', headers: admin });
    const cityPage = cityRes.json() as Paginated<InfluencerSummaryDTO>;
    expect(cityPage.data.map((r) => r.id)).toContain(aeInfluencerId);
    expect(cityPage.data.map((r) => r.id)).not.toContain(kwInfluencerId);
  });

  it('a KW-scoped Influencer Manager lists only KW creators, even without an explicit countryCode filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/influencers?pageSize=100', headers: kwAuth });
    expect(res.statusCode).toBe(200);
    const page = res.json() as Paginated<InfluencerSummaryDTO>;
    const ids = page.data.map((r) => r.id);
    expect(ids).toContain(kwInfluencerId);
    expect(ids).not.toContain(aeInfluencerId);
  });

  it('a KW-scoped Influencer Manager reaches the KW creator directly by id', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${kwInfluencerId}`, headers: kwAuth });
    expect(res.statusCode).toBe(200);
    expect((res.json() as InfluencerDetailDTO).id).toBe(kwInfluencerId);
  });

  it('a KW-scoped Influencer Manager is rejected reaching the UAE creator directly by id — not merely hidden in a list', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${aeInfluencerId}`, headers: kwAuth });
    expect(res.statusCode).toBe(404);
  });

  it('a KW-scoped Influencer Manager cannot update the out-of-scope UAE creator either', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/influencers/${aeInfluencerId}`, headers: kwAuth, payload: { city: 'Abu Dhabi' } });
    expect(res.statusCode).toBe(404);
  });
});
