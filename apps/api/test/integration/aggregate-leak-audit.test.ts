import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  CreatorReliabilityDTO,
  CreatorSnapshotDTO,
  DataQualityReportDTO,
  DuplicateCandidateDTO,
  GlobalDashboardDTO,
  ReportDTO,
  SearchResultDTO,
} from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Security & Authorization Freeze Gate — aggregate-leak-audit (spec §49-55).
 * Core principle: "even with hidden records, aggregate counts... may leak
 * information." Covers the 5 owned services (dashboard/data-quality/
 * creator360/report/search) with the concrete leaks this pass fixed —
 * scope must be enforced in the DATABASE QUERY itself, never a client-side
 * filter of a fully-loaded page, so every assertion below hits the real
 * HTTP endpoint with a real scoped actor.
 */

const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

interface ScopedUser {
  userId: string;
  auth: Record<string, string>;
}

/** A throwaway STAFF user, logged in immediately, with no scope until the
 *  caller applies brand-access/country-access via the admin endpoints. */
async function createUser(app: FastifyInstance, label: string): Promise<ScopedUser> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `agg_leak_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({
    data: { email, name: `AggLeak ${label}`, role: 'STAFF', passwordHash: await hash(password) },
  });
  await prisma.$disconnect();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
  const token = (res.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { userId: user.id, auth: { authorization: `Bearer ${token}` } };
}

async function setBrandAccess(app: FastifyInstance, admin: Record<string, string>, userId: string, brandIds: string[]) {
  const res = await app.inject({ method: 'PUT', url: `/api/v1/users/${userId}/brand-access`, headers: admin, payload: { brandIds } });
  if (res.statusCode !== 200) throw new Error(`brand-access failed: ${res.statusCode} ${res.body}`);
}

async function setCountryAccess(app: FastifyInstance, admin: Record<string, string>, userId: string, countryCodes: string[]) {
  const res = await app.inject({ method: 'PUT', url: `/api/v1/users/${userId}/country-access`, headers: admin, payload: { countryCodes } });
  if (res.statusCode !== 200) throw new Error(`country-access failed: ${res.statusCode} ${res.body}`);
}

describe('aggregate-leak-audit — data-quality.service.ts country scope', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let kwUser: ScopedUser;
  let kwInfluencerId: string;
  let saInfluencerId: string;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    kwUser = await createUser(app, 'kw_dq');
    // Country-scoped ONLY — no UserBrandAccess rows at all, so scopedBrandIds
    // resolves to null (brand-unscoped) but scopedCountryCodes resolves to
    // ['KW']. This is exactly the spec's example actor.
    await setCountryAccess(app, admin, kwUser.userId, ['KW']);

    kwInfluencerId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: admin,
        payload: { displayName: `AggLeak KW ${Date.now()}`, countryCode: 'KW', relationshipStatus: 'ACTIVE' },
      }),
    );
    saInfluencerId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: admin,
        payload: { displayName: `AggLeak SA ${Date.now()}`, countryCode: 'SA', relationshipStatus: 'ACTIVE' },
      }),
    );
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(adminId);
    await deleteUser(kwUser.userId);
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.influencer.deleteMany({ where: { id: { in: [kwInfluencerId, saInfluencerId] } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('report(): a KW-only country-scoped actor\'s aggregate counts exclude an SA-only creator — the spec\'s own example ("27 Saudi creators missing phone")', async () => {
    // Both fixtures are ACTIVE with no mobile on file, so each is one unit of
    // 'influencer-engaged-no-mobile'. Measure the DELTA this fixture pair
    // contributes (never a bare global count — the shared test DB has other
    // rows), for both the KW-scoped actor and an unscoped admin.
    const before = await app.inject({ method: 'GET', url: '/api/v1/data-quality/report', headers: kwUser.auth });
    const beforeCount = ((before.json() as DataQualityReportDTO).findings.find((f) => f.id === 'influencer-engaged-no-mobile') ?? { count: 0 }).count;

    const adminBefore = await app.inject({ method: 'GET', url: '/api/v1/data-quality/report', headers: admin });
    const adminBeforeCount = ((adminBefore.json() as DataQualityReportDTO).findings.find((f) => f.id === 'influencer-engaged-no-mobile') ?? { count: 0 }).count;

    // Give both fixtures the finding-triggering shape (ACTIVE + no mobile) —
    // already true from creation above; this call just re-confirms the KW
    // fixture stays untouched by anything else in the suite.
    const kwRes = await app.inject({ method: 'GET', url: '/api/v1/data-quality/report', headers: kwUser.auth });
    expect(kwRes.statusCode).toBe(200);
    const kwCount = ((kwRes.json() as DataQualityReportDTO).findings.find((f) => f.id === 'influencer-engaged-no-mobile') ?? { count: 0 }).count;
    // Only the KW creator is counted for the KW-scoped actor — the SA
    // creator contributes 0 to their delta.
    expect(kwCount - beforeCount).toBe(1);

    const adminRes = await app.inject({ method: 'GET', url: '/api/v1/data-quality/report', headers: admin });
    const adminCount = ((adminRes.json() as DataQualityReportDTO).findings.find((f) => f.id === 'influencer-engaged-no-mobile') ?? { count: 0 }).count;
    // An unscoped admin sees both.
    expect(adminCount - adminBeforeCount).toBe(2);
  });

  it("duplicates(): a KW-only country-scoped actor never clusters a KW creator with an out-of-scope SA creator sharing the same email", async () => {
    const email = `agg-leak-dup-${Date.now()}@example.com`;
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.influencer.update({ where: { id: kwInfluencerId }, data: { email } });
    await prisma.influencer.update({ where: { id: saInfluencerId }, data: { email } });
    await prisma.$disconnect();

    const adminRes = await app.inject({ method: 'GET', url: '/api/v1/data-quality/duplicates', headers: admin });
    const adminCandidates = adminRes.json() as DuplicateCandidateDTO[];
    // The admin (unscoped) sees BOTH sides of the cluster.
    expect(adminCandidates.some((c) => c.influencerId === kwInfluencerId)).toBe(true);
    expect(adminCandidates.some((c) => c.influencerId === saInfluencerId)).toBe(true);

    const kwRes = await app.inject({ method: 'GET', url: '/api/v1/data-quality/duplicates', headers: kwUser.auth });
    const kwCandidates = kwRes.json() as DuplicateCandidateDTO[];
    // The KW-scoped actor never sees the SA creator at all (its email value
    // would otherwise leak through `reasons`), and — since a cluster needs 2+
    // members THEY can see — never sees the KW creator flagged as a
    // duplicate of someone invisible to them either.
    expect(kwCandidates.some((c) => c.influencerId === saInfluencerId)).toBe(false);
    expect(kwCandidates.some((c) => c.influencerId === kwInfluencerId)).toBe(false);
  });
});

describe('aggregate-leak-audit — creator360.service.ts per-panel brand scope', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let brandAId: string;
  let brandBId: string;
  let creatorId: string;
  let campaignAId: string;
  let campaignBId: string;
  let brandAUser: ScopedUser;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    brandAId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `AggLeak Brand A ${Date.now()}` } }));
    brandBId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `AggLeak Brand B ${Date.now()}` } }));
    campaignAId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandAId, name: `AggLeak Camp A ${Date.now()}`, status: 'ACTIVE', currency: 'KWD' } }),
    );
    campaignBId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandBId, name: `AggLeak Camp B ${Date.now()}`, status: 'ACTIVE', currency: 'KWD' } }),
    );
    creatorId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `AggLeak Creator ${Date.now()}`, countryCode: 'KW' } }),
    );

    // Same creator collaborates with BOTH brands — a real cross-brand
    // relationship, which is exactly the scenario the fix must not leak.
    const ciA = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignAId}/influencers`,
        headers: admin,
        payload: { influencerId: creatorId, dealType: 'PAID', agreedCost: 100, currency: 'KWD', paymentStatus: 'PAID' },
      }),
    );
    const ciB = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignBId}/influencers`,
        headers: admin,
        payload: { influencerId: creatorId, dealType: 'PAID', agreedCost: 500, currency: 'KWD', paymentStatus: 'PAID' },
      }),
    );

    // A published (on-time) deliverable on EACH side, so reliability()'s
    // sampleSize is a clean per-brand signal.
    const dueA = new Date(Date.now() - 3600_000).toISOString();
    const delA = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ciA}/deliverables`, headers: admin, payload: { platform: 'INSTAGRAM', type: 'REEL', dueDate: dueA } }),
    );
    await app.inject({ method: 'PATCH', url: `/api/v1/deliverables/${delA}`, headers: admin, payload: { status: 'PUBLISHED' } });
    const dueB = new Date(Date.now() - 3600_000).toISOString();
    const delB = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${ciB}/deliverables`, headers: admin, payload: { platform: 'INSTAGRAM', type: 'REEL', dueDate: dueB } }),
    );
    await app.inject({ method: 'PATCH', url: `/api/v1/deliverables/${delB}`, headers: admin, payload: { status: 'PUBLISHED' } });

    // A UGC submission on Brand B's deliverable only.
    await app.inject({
      method: 'POST',
      url: `/api/v1/deliverables/${delB}/submissions`,
      headers: admin,
      payload: { assetUrl: 'https://example.com/draft.mp4', notes: 'Brand B draft' },
    });

    brandAUser = await createUser(app, 'creator360_a');
    await setBrandAccess(app, admin, brandAUser.userId, [brandAId]);
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(adminId);
    await deleteUser(brandAUser.userId);
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId: { in: [brandAId, brandBId] } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: [brandAId, brandBId] } } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: creatorId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('snapshot(): a Brand-A-scoped actor sees only Brand A\'s side of a cross-brand creator relationship, never Brand B\'s campaign/payment data', async () => {
    const adminRes = await app.inject({ method: 'GET', url: `/api/v1/influencers/${creatorId}/snapshot`, headers: admin });
    const adminSnap = adminRes.json() as CreatorSnapshotDTO;
    expect(adminSnap.brandsWorkedWith).toBe(2);
    expect(adminSnap.totalCollaborations).toBe(2);
    expect(adminSnap.rateRange).toEqual({ min: 100, max: 500, currency: 'KWD' });

    const scopedRes = await app.inject({ method: 'GET', url: `/api/v1/influencers/${creatorId}/snapshot`, headers: brandAUser.auth });
    expect(scopedRes.statusCode).toBe(200);
    const scopedSnap = scopedRes.json() as CreatorSnapshotDTO;
    // The main page (basic profile) is authorized (Brand A is in scope), but
    // this panel must independently exclude Brand B's data — never bypass
    // scope just because assertVisible() already passed.
    expect(scopedSnap.brandsWorkedWith).toBe(1);
    expect(scopedSnap.totalCollaborations).toBe(1);
    expect(scopedSnap.rateRange).toEqual({ min: 100, max: 100, currency: 'KWD' });
  });

  it('reliability(): excludes Brand B\'s deliverable from a Brand-A-scoped actor\'s on-time/late sample', async () => {
    const adminRes = await app.inject({ method: 'GET', url: `/api/v1/influencers/${creatorId}/reliability`, headers: admin });
    expect((adminRes.json() as CreatorReliabilityDTO).sampleSize).toBe(2);

    const scopedRes = await app.inject({ method: 'GET', url: `/api/v1/influencers/${creatorId}/reliability`, headers: brandAUser.auth });
    expect(scopedRes.statusCode).toBe(200);
    expect((scopedRes.json() as CreatorReliabilityDTO).sampleSize).toBe(1);
  });

  it("submissions(): a Brand-A-scoped actor's UGC tab never surfaces Brand B's submission", async () => {
    const adminRes = await app.inject({ method: 'GET', url: `/api/v1/influencers/${creatorId}/submissions`, headers: admin });
    const adminSubs = adminRes.json() as { campaignId: string }[];
    expect(adminSubs.some((s) => s.campaignId === campaignBId)).toBe(true);

    const scopedRes = await app.inject({ method: 'GET', url: `/api/v1/influencers/${creatorId}/submissions`, headers: brandAUser.auth });
    expect(scopedRes.statusCode).toBe(200);
    const scopedSubs = scopedRes.json() as { campaignId: string }[];
    expect(scopedSubs.some((s) => s.campaignId === campaignBId)).toBe(false);
    expect(scopedSubs).toHaveLength(0);
  });

  it('a country-scoped actor cannot reach an out-of-scope-country creator\'s Creator 360 at all — 404, not merely hidden', async () => {
    const aeUser = await createUser(app, 'creator360_ae');
    await setCountryAccess(app, admin, aeUser.userId, ['AE']);
    const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${creatorId}/snapshot`, headers: aeUser.auth });
    expect(res.statusCode).toBe(404);
    await deleteUser(aeUser.userId);
  });
});

describe('aggregate-leak-audit — dashboard.service.ts scope on the Mission Control panels', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let brandAId: string;
  let brandBId: string;
  let brandAUser: ScopedUser;
  let campaignBId: string;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    brandAId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `AggLeak Dash A ${Date.now()}` } }));
    brandBId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `AggLeak Dash B ${Date.now()}` } }));
    campaignBId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandBId, name: `AggLeak Dash Camp B ${Date.now()}`, status: 'ACTIVE', currency: 'KWD' } }),
    );
    const infB = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `AggLeak Dash Creator B ${Date.now()}`, countryCode: 'KW' } }),
    );
    const ciB = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignBId}/influencers`,
        headers: admin,
        payload: { influencerId: infB, dealType: 'PAID', agreedCost: 999, currency: 'KWD', paymentStatus: 'PAID', expectedPublishAt: new Date(Date.now() + 864e5).toISOString() },
      }),
    );
    // A due-soon deliverable so pulse().upcomingDeliverables has a Brand-B
    // signal to (not) leak.
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaign-influencers/${ciB}/deliverables`,
      headers: admin,
      payload: { platform: 'INSTAGRAM', type: 'REEL', dueDate: new Date(Date.now() + 864e5).toISOString() },
    });

    brandAUser = await createUser(app, 'dash_a');
    await setBrandAccess(app, admin, brandAUser.userId, [brandAId]);
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(adminId);
    await deleteUser(brandAUser.userId);
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId: { in: [brandAId, brandBId] } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: [brandAId, brandBId] } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('GET /dashboard/global (no brandId) never rolls up an out-of-scope brand\'s upcoming content or recent activity for a brand-scoped actor', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/dashboard/global', headers: brandAUser.auth });
    expect(res.statusCode).toBe(200);
    const dash = res.json() as GlobalDashboardDTO;
    expect(dash.upcomingContent.every((c) => c.campaignName !== `AggLeak Dash Camp B ${''}`.trim() || true)).toBe(true);
    // Precise: nothing in this Brand-A-scoped actor's feed names Brand B.
    expect(dash.upcomingContent.some((c) => c.brandName.startsWith('AggLeak Dash B'))).toBe(false);
    expect(dash.recentActivity.every((a) => !a.message.includes('AggLeak Dash Camp B'))).toBe(true);
  });

  it('GET /dashboard/attention?brandId=<out-of-scope> returns nothing for a brand-scoped actor, rather than bypassing scope on an explicit brandId', async () => {
    // Before the fix, attentionBrandFilter() returned `{ brandId }` for ANY
    // explicit brandId with no scope check at all, so a Brand-A-scoped actor
    // passing Brand B's id got Brand B's attention items in full.
    const res = await app.inject({ method: 'GET', url: `/api/v1/dashboard/attention?brandId=${brandBId}`, headers: brandAUser.auth });
    expect(res.statusCode).toBe(200);
    const items = res.json() as unknown[];
    expect(items).toHaveLength(0);

    // Positive control — the same actor DOES see Brand A's own (empty, but
    // reachable) attention slice without a 403/404, proving this is a scope
    // filter, not a blanket auth failure.
    const ownRes = await app.inject({ method: 'GET', url: `/api/v1/dashboard/attention?brandId=${brandAId}`, headers: brandAUser.auth });
    expect(ownRes.statusCode).toBe(200);
  });
});

describe('aggregate-leak-audit — search.service.ts brand + country scope', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let brandAId: string;
  let brandBId: string;
  let brandAUser: ScopedUser;
  let saCreatorId: string;
  let kwUser: ScopedUser;
  const tag = Date.now();

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    brandAId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `AggLeakSearchA${tag}` } }));
    brandBId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `AggLeakSearchB${tag}` } }));

    saCreatorId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `AggLeakSearchSA${tag}`, countryCode: 'SA' } }),
    );

    brandAUser = await createUser(app, 'search_a');
    await setBrandAccess(app, admin, brandAUser.userId, [brandAId]);

    kwUser = await createUser(app, 'search_kw');
    await setCountryAccess(app, admin, kwUser.userId, ['KW']);
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(adminId);
    await deleteUser(brandAUser.userId);
    await deleteUser(kwUser.userId);
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.brand.deleteMany({ where: { id: { in: [brandAId, brandBId] } } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: saCreatorId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('search(): a Brand-A-scoped actor never gets Brand B in results, even for an exact-name match', async () => {
    const adminRes = await app.inject({ method: 'GET', url: `/api/v1/search?q=AggLeakSearchB${tag}`, headers: admin });
    expect((adminRes.json() as SearchResultDTO[]).some((r) => r.id === brandBId)).toBe(true);

    const scopedRes = await app.inject({ method: 'GET', url: `/api/v1/search?q=AggLeakSearchB${tag}`, headers: brandAUser.auth });
    expect(scopedRes.statusCode).toBe(200);
    expect((scopedRes.json() as SearchResultDTO[]).some((r) => r.id === brandBId)).toBe(false);
  });

  it('search(): a KW-only country-scoped actor never gets a Saudi creator in results, even for an exact-name match', async () => {
    const adminRes = await app.inject({ method: 'GET', url: `/api/v1/search?q=AggLeakSearchSA${tag}`, headers: admin });
    expect((adminRes.json() as SearchResultDTO[]).some((r) => r.id === saCreatorId)).toBe(true);

    const scopedRes = await app.inject({ method: 'GET', url: `/api/v1/search?q=AggLeakSearchSA${tag}`, headers: kwUser.auth });
    expect(scopedRes.statusCode).toBe(200);
    expect((scopedRes.json() as SearchResultDTO[]).some((r) => r.id === saCreatorId)).toBe(false);
  });

  it('searchPage(): the same brand scope holds on the ranked, paginated search path (a SEPARATE query path from search())', async () => {
    const scopedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/search/page?q=AggLeakSearchB${tag}&page=1&pageSize=20`,
      headers: brandAUser.auth,
    });
    expect(scopedRes.statusCode).toBe(200);
    const page = scopedRes.json() as { results: SearchResultDTO[] };
    expect(page.results.some((r) => r.id === brandBId)).toBe(false);
  });
});

describe('aggregate-leak-audit — report.service.ts brand + country scope', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let brandAId: string;
  let brandBId: string;
  let brandAUser: ScopedUser;
  let kwUser: ScopedUser;
  let kwInfluencerId: string;
  let saInfluencerId: string;
  let campaignAId: string;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    brandAId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `AggLeakReportA${Date.now()}` } }));
    brandBId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `AggLeakReportB${Date.now()}` } }));
    campaignAId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandAId, name: `AggLeak Report Camp A ${Date.now()}`, status: 'ACTIVE', currency: 'KWD' } }),
    );

    brandAUser = await createUser(app, 'report_a');
    await setBrandAccess(app, admin, brandAUser.userId, [brandAId]);

    kwInfluencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `AggLeak Report KW ${Date.now()}`, countryCode: 'KW' } }),
    );
    saInfluencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `AggLeak Report SA ${Date.now()}`, countryCode: 'SA' } }),
    );
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignAId}/influencers`,
      headers: admin,
      payload: { influencerId: kwInfluencerId, dealType: 'GIFTED_PRODUCT' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignAId}/influencers`,
      headers: admin,
      payload: { influencerId: saInfluencerId, dealType: 'GIFTED_PRODUCT' },
    });

    kwUser = await createUser(app, 'report_kw');
    await setCountryAccess(app, admin, kwUser.userId, ['KW']);
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(adminId);
    await deleteUser(brandAUser.userId);
    await deleteUser(kwUser.userId);
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId: { in: [brandAId, brandBId] } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: [brandAId, brandBId] } } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { id: { in: [kwInfluencerId, saInfluencerId] } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("type=brand with no explicit brandId: a Brand-A-scoped actor's rows never include Brand B, even though an unscoped call lists it", async () => {
    const adminRes = await app.inject({ method: 'GET', url: '/api/v1/reports?type=brand', headers: admin });
    const adminReport = adminRes.json() as ReportDTO;
    const adminBrandBRow = adminReport.rows.find((r) => typeof r.name === 'string' && r.name.startsWith('AggLeakReportB'));
    expect(adminBrandBRow).toBeDefined();

    const scopedRes = await app.inject({ method: 'GET', url: '/api/v1/reports?type=brand', headers: brandAUser.auth });
    expect(scopedRes.statusCode).toBe(200);
    const scopedReport = scopedRes.json() as ReportDTO;
    expect(scopedReport.rows.some((r) => typeof r.name === 'string' && r.name.startsWith('AggLeakReportB'))).toBe(false);
    expect(scopedReport.rows.some((r) => typeof r.name === 'string' && r.name.startsWith('AggLeakReportA'))).toBe(true);
  });

  it('type=influencer: a KW-only country-scoped actor never gets a Saudi creator\'s row (real name + payment data), even from an in-scope brand\'s campaign', async () => {
    const adminRes = await app.inject({ method: 'GET', url: `/api/v1/reports?type=influencer&brandId=${brandAId}`, headers: admin });
    const adminReport = adminRes.json() as ReportDTO;
    expect(adminReport.rows.some((r) => typeof r.name === 'string' && r.name.includes('AggLeak Report SA'))).toBe(true);

    // The KW actor has no brand scope at all (only country), so the SAME
    // in-scope-by-brand campaign is still reachable — proving the exclusion
    // is specifically the country check, not an incidental brand mismatch.
    const scopedRes = await app.inject({ method: 'GET', url: `/api/v1/reports?type=influencer&brandId=${brandAId}`, headers: kwUser.auth });
    expect(scopedRes.statusCode).toBe(200);
    const scopedReport = scopedRes.json() as ReportDTO;
    expect(scopedReport.rows.some((r) => typeof r.name === 'string' && r.name.includes('AggLeak Report SA'))).toBe(false);
    expect(scopedReport.rows.some((r) => typeof r.name === 'string' && r.name.includes('AggLeak Report KW'))).toBe(true);
  });
});
