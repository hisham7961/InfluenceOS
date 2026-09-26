import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@influenceos/api-client';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P3.7 — rate benchmarks: bookings keep the creator's main platform and size
 * when booked; the figures (fee per post, cost per view, engagement rate —
 * median and middle half) come from confirmed paid bookings only, one
 * currency at a time, within scope; fee figures need finance access; below
 * three bookings a figure is left out.
 */
describe('P3.7 — rate benchmarks', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let api: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const creators: string[] = [];
  const tag = `P37B${Date.now()}`;
  let brandId: string;
  let kwd: string;
  let sar: string;
  const rows: Record<string, string> = {};
  const accounts: Record<string, string> = {};

  async function status(p: Promise<unknown>) {
    try {
      await p;
      return 200;
    } catch (e) {
      return (e as ApiError).status;
    }
  }

  async function userClient(label: string, roleProfile: 'VIEWER' | 'GENERAL_MANAGER', country?: string) {
    const { hash } = await import('@node-rs/argon2');
    const email = `${tag.toLowerCase()}_${label}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: { email, name: `${tag} ${label}`, role: 'STAFF', roleProfile, passwordHash: await hash(password) },
    });
    users.push(user.id);
    if (country) await prisma.userCountryAccess.create({ data: { userId: user.id, countryCode: country } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    const { accessToken } = (res.json() as { tokens: { accessToken: string } }).tokens;
    return clientFor(app, { authorization: `Bearer ${accessToken}` });
  }

  async function creator(key: string, platform: 'INSTAGRAM' | 'TIKTOK', followers: number) {
    const id = (await api.influencers.create({ displayName: `${tag} ${key}`, countryCode: 'KW' })).id;
    creators.push(id);
    accounts[key] = (
      await prisma.socialAccount.create({
        data: { influencerId: id, platform, username: `${tag}_${key}`.toLowerCase(), followers },
      })
    ).id;
    return id;
  }

  async function book(
    key: string,
    campaignId: string,
    influencerId: string,
    agreedCost: number,
    participationStatus: 'CONFIRMED' | 'INVITED' = 'CONFIRMED',
  ) {
    const ci = await api.campaigns.addInfluencer(campaignId, {
      influencerId,
      dealType: 'PAID',
      agreedCost,
      participationStatus,
    });
    rows[key] = ci.id;
    return ci;
  }

  async function post(campaignId: string, influencerId: string, views: number, likes: number) {
    const p = await prisma.publishedContent.create({
      data: {
        platform: 'INSTAGRAM',
        originalUrl: `https://example.test/${tag}/${influencerId}/${views}`,
        brandId,
        campaignId,
        influencerId,
        publishedAt: new Date(),
      },
    });
    const snap = await prisma.contentMetricSnapshot.create({ data: { publishedContentId: p.id, views, likes } });
    await prisma.publishedContent.update({ where: { id: p.id }, data: { latestSnapshotId: snap.id } });
  }

  beforeAll(async () => {
    app = await makeApp();
    const admin = await loginFresh(app);
    users.push(admin.userId);
    api = await clientFor(app, admin.auth);
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    brandId = (await prisma.brand.create({ data: { name: `${tag} Brand`, slug: `${tag.toLowerCase()}-b` } })).id;
    kwd = (await prisma.campaign.create({ data: { brandId, name: `${tag} KWD`, slug: `${tag.toLowerCase()}-k` } })).id;
    sar = (
      await prisma.campaign.create({
        data: { brandId, name: `${tag} SAR`, slug: `${tag.toLowerCase()}-s`, currency: 'SAR' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.brand.deleteMany({ where: { id: brandId } });
    await prisma.influencer.deleteMany({ where: { id: { in: creators } } });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  it("keeps the creator's main platform and size on the booking", async () => {
    const a1 = await creator('a1', 'INSTAGRAM', 20_000);
    const a2 = await creator('a2', 'INSTAGRAM', 40_000);
    const a3 = await creator('a3', 'INSTAGRAM', 60_000);
    const a4 = await creator('a4', 'INSTAGRAM', 300_000);
    const a5 = await creator('a5', 'TIKTOK', 20_000);
    const a6 = await creator('a6', 'INSTAGRAM', 30_000);

    const first = await book('a1', kwd, a1, 200);
    expect(first).toMatchObject({ platformAtBooking: 'INSTAGRAM', followersAtBooking: 20_000 });
    // Two posts planned: 100 a post.
    await api.campaignInfluencers.addDeliverable(first.id, { platform: 'INSTAGRAM', type: 'REEL', quantity: 2 });
    await book('a2', kwd, a2, 300);
    await book('a3', kwd, a3, 500);
    await book('a4', kwd, a4, 1000);
    await book('a5', kwd, a5, 150);
    await book('a6', kwd, a6, 9999, 'INVITED'); // not agreed: left out
    await book('a1sar', sar, a1, 700);

    await post(kwd, a1, 1000, 50); // 0.2 a view, 5%
    await post(kwd, a2, 3000, 60); // 0.1 a view, 2%
    await post(kwd, a3, 10_000, 300); // 0.05 a view, 3%

    // They grow afterwards; the booking keeps the size they had.
    await prisma.socialAccount.update({ where: { id: accounts.a1 }, data: { followers: 2_000_000 } });
  });

  it('gives the median and middle half for a platform and follower tier', async () => {
    const b = await api.reports.benchmarks({ brandId, platform: 'INSTAGRAM', tier: 'MICRO' });
    expect(b).toMatchObject({
      currency: 'KWD',
      months: 12,
      minSample: 3,
      moneyVisible: true,
      platform: 'INSTAGRAM',
      tier: 'MICRO',
    });
    expect(b.overall.bookings).toBe(3);
    expect(b.overall.feePerPost).toEqual({ median: 300, p25: 200, p75: 400, sampleSize: 3 });
    expect(b.overall.costPerView!.median).toBeCloseTo(0.1);
    expect(b.overall.engagementRate!.median).toBeCloseTo(3);
    expect(b.otherCurrencies).toEqual([{ currency: 'SAR', bookings: 1 }]);

    const cells = Object.fromEntries(b.grid.map((c) => [`${c.platform}:${c.tier}`, c]));
    expect(Object.keys(cells).sort()).toEqual(['INSTAGRAM:MICRO', 'INSTAGRAM:MID', 'TIKTOK:MICRO']);
    expect(cells['INSTAGRAM:MID']).toMatchObject({ bookings: 1, feePerPost: null });

    const sarOnly = await api.reports.benchmarks({ brandId, currency: 'sar' });
    expect(sarOnly.currency).toBe('SAR');
    expect(sarOnly.overall.bookings).toBe(1);
  });

  it('works from a creator or a roster row (which is left out of its own figures)', async () => {
    const forRow = await api.reports.benchmarks({ brandId, campaignInfluencerId: rows.a2 });
    expect(forRow).toMatchObject({ platform: 'INSTAGRAM', tier: 'MICRO' });
    expect(forRow.overall.bookings).toBe(2);
    expect(forRow.overall.feePerPost).toBeNull();

    // A creator is judged by their main account now: a1 has grown to mega.
    const forCreator = await api.reports.benchmarks({ brandId, influencerId: creators[0] });
    expect(forCreator).toMatchObject({ platform: 'INSTAGRAM', tier: 'MEGA' });
    expect(forCreator.overall.bookings).toBe(0);
  });

  it('looks back over the chosen period', async () => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2);
    await prisma.campaignInfluencer.update({ where: { id: rows.a3 }, data: { createdAt: twoYearsAgo } });
    expect((await api.reports.benchmarks({ brandId, platform: 'INSTAGRAM', tier: 'MICRO' })).overall.bookings).toBe(2);
    const allTime = await api.reports.benchmarks({ brandId, platform: 'INSTAGRAM', tier: 'MICRO', months: 0 });
    expect(allTime.overall.bookings).toBe(3);
    expect(allTime.since).toBeNull();
    expect(await status(api.reports.benchmarks({ months: 5 }))).toBe(422);
  });

  it('hides fee figures without finance access and keeps to scope', async () => {
    const viewer = await userClient('viewer', 'VIEWER');
    const seen = await viewer.reports.benchmarks({ brandId, platform: 'INSTAGRAM', tier: 'MICRO', months: 0 });
    expect(seen.moneyVisible).toBe(false);
    expect(seen.overall.bookings).toBe(3);
    expect(seen.overall.feePerPost).toBeNull();
    expect(seen.overall.costPerView).toBeNull();
    expect(seen.overall.engagementRate!.median).toBeCloseTo(3);

    const saOnly = await userClient('sa', 'GENERAL_MANAGER', 'SA');
    expect((await saOnly.reports.benchmarks({ brandId, months: 0 })).overall.bookings).toBe(0);
    expect(await status(saOnly.reports.benchmarks({ countryCode: 'KW' }))).toBe(404);
    expect(await status(saOnly.reports.benchmarks({ influencerId: creators[0] }))).toBe(404);
    expect(await status(saOnly.reports.benchmarks({ campaignInfluencerId: rows.a2 }))).toBe(404);
  });
});
