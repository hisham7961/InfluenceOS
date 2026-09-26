import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CreatorLeaderboardDTO, CreatorPerformanceDTO, ExecDashboardDTO, TrendsDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P2.7 — the owner's results over time: a period (custom here) against the
 * one before it, week/month trends, a creator's performance history and a
 * leaderboard that ranks by results and reliability. Money (payments) is
 * shown only with finance access. Dates are in 2019 on a brand of its own so
 * nothing else in the database falls in the windows.
 */
const kw = (iso: string) => new Date(`${iso}+03:00`);

describe('P2.7 — periods, trends, creator performance, leaderboard', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let staff: { auth: Record<string, string>; userId: string };
  let prisma: import('@influenceos/database').PrismaClient;
  const tag = `P27${Date.now()}`;
  let brandId: string;
  let influencerId: string;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    prisma = new PrismaClient();

    brandId = (await prisma.brand.create({ data: { name: `${tag} Brand`, slug: tag.toLowerCase() } })).id;
    influencerId = (await prisma.influencer.create({ data: { displayName: `${tag} Noor`, countryCode: 'KW' } })).id;
    await prisma.brandInfluencer.create({ data: { brandId, influencerId } });
    const campaign = await prisma.campaign.create({
      data: { brandId, name: `${tag} Spring`, slug: `${tag.toLowerCase()}-spring`, status: 'ACTIVE', currency: 'KWD', startDate: kw('2019-03-02T09:00:00') },
    });
    const ci = await prisma.campaignInfluencer.create({
      data: { campaignId: campaign.id, influencerId, participationStatus: 'CONFIRMED', dealType: 'PAID', agreedCost: 400, currency: 'KWD' },
    });
    // Two deliverables posted in March: one on its due day, one three days late.
    await prisma.deliverable.create({
      data: { campaignInfluencerId: ci.id, platform: 'INSTAGRAM', type: 'REEL', status: 'PUBLISHED', dueDate: kw('2019-03-10T00:00:00'), publishedAt: kw('2019-03-10T20:00:00') },
    });
    await prisma.deliverable.create({
      data: { campaignInfluencerId: ci.id, platform: 'TIKTOK', type: 'VIDEO', status: 'PUBLISHED', dueDate: kw('2019-03-12T00:00:00'), publishedAt: kw('2019-03-15T10:00:00') },
    });
    const post = async (day: string, platform: 'INSTAGRAM' | 'TIKTOK', views: number, likes: number, comments: number) => {
      const p = await prisma.publishedContent.create({
        data: {
          platform,
          originalUrl: `https://example.test/${tag}/${day}/${platform}`,
          brandId,
          campaignId: campaign.id,
          influencerId,
          publishedAt: kw(`${day}T12:00:00`),
          detectedAt: kw(`${day}T12:00:00`),
        },
      });
      await prisma.contentMetricSnapshot.create({ data: { publishedContentId: p.id, views, likes, comments } });
    };
    await post('2019-03-10', 'INSTAGRAM', 1000, 50, 10);
    await post('2019-03-20', 'TIKTOK', 3000, 90, 10);
    await post('2019-02-15', 'INSTAGRAM', 500, 20, 5); // the previous period

    await prisma.payment.create({ data: { campaignId: campaign.id, campaignInfluencerId: ci.id, amount: 300, currency: 'KWD', paidAt: kw('2019-03-05T10:00:00') } });
    // A voided payment never counts.
    await prisma.payment.create({
      data: { campaignId: campaign.id, campaignInfluencerId: ci.id, amount: 50, currency: 'KWD', paidAt: kw('2019-03-06T10:00:00'), voidedAt: new Date(), voidReason: 'entered twice' },
    });

    const password = 'Str0ng-Passw0rd!';
    const email = `p27_staff_${Date.now()}@example.test`;
    const user = await prisma.user.create({ data: { email, name: 'P27 Staff', role: 'STAFF', roleProfile: 'INFLUENCER_MANAGER', passwordHash: await hash(password) } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    staff = { userId: user.id, auth: { authorization: `Bearer ${(res.json() as { tokens: { accessToken: string } }).tokens.accessToken}` } };
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { campaign: { brandId } } });
    await prisma.publishedContent.deleteMany({ where: { brandId } });
    await prisma.campaign.deleteMany({ where: { brandId } });
    await prisma.brandInfluencer.deleteMany({ where: { brandId } });
    await prisma.influencer.deleteMany({ where: { id: influencerId } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    await prisma.$disconnect();
    await app.close();
    await deleteUser(staff.userId);
    await deleteUser(adminId);
  });

  it('a period is compared with the same number of days before it', async () => {
    const dash = (
      await app.inject({ method: 'GET', url: `/api/v1/reports/exec-dashboard?brandId=${brandId}&period=custom&from=2019-03-01&to=2019-03-31`, headers: admin })
    ).json() as ExecDashboardDTO;
    const p = dash.period;
    expect([p.period, p.from, p.to, p.previousFrom, p.previousTo]).toEqual(['custom', '2019-03-01', '2019-03-31', '2019-01-29', '2019-02-28']);
    expect(p.current).toMatchObject({
      postsPublished: 2,
      views: 4000,
      engagements: 160,
      engagementRate: 4,
      deliverablesDelivered: 2,
      onTimeRate: 0.5,
      activeCreators: 1,
      campaignsStarted: 1,
      paid: [{ currency: 'KWD', amount: 300 }],
      costPerView: { currency: 'KWD', value: 0.075 },
    });
    expect(p.previous).toMatchObject({ postsPublished: 1, views: 500, deliverablesDelivered: 0, onTimeRate: null, paid: [] });
  });

  it('trends: month and week buckets in Kuwait days; money only with finance access', async () => {
    const months = (
      await app.inject({ method: 'GET', url: `/api/v1/reports/trends?brandId=${brandId}&bucket=month&from=2019-01-01&to=2019-03-31`, headers: admin })
    ).json() as TrendsDTO;
    expect(months.points.map((pt) => [pt.start, pt.postsPublished, pt.views, pt.deliverablesDelivered])).toEqual([
      ['2019-01-01', 0, null, 0],
      ['2019-02-01', 1, 500, 0],
      ['2019-03-01', 2, 4000, 2],
    ]);
    expect(months.points[2]!.paid).toEqual([{ currency: 'KWD', amount: 300 }]);
    expect(months.currencies).toEqual(['KWD']);

    const weeks = (
      await app.inject({ method: 'GET', url: `/api/v1/reports/trends?brandId=${brandId}&bucket=week&from=2019-03-10&to=2019-03-23`, headers: admin })
    ).json() as TrendsDTO;
    // 10 March 2019 is a Sunday: two weeks, one post each.
    expect(weeks.points.map((pt) => [pt.start, pt.postsPublished])).toEqual([
      ['2019-03-10', 1],
      ['2019-03-17', 1],
    ]);

    const staffView = await app.inject({ method: 'GET', url: `/api/v1/reports/trends?bucket=month&from=2019-03-01&to=2019-03-31`, headers: staff.auth });
    expect(staffView.statusCode).toBe(200);
    expect((staffView.json() as TrendsDTO).points.every((pt) => pt.paid === null)).toBe(true);

    const bad = await app.inject({ method: 'GET', url: '/api/v1/reports/trends?bucket=day', headers: admin });
    expect(bad.statusCode).toBe(422);
  });

  it("a creator's performance history: medians, reliability, rebooking, paid and cost per view", async () => {
    const perf = (await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/performance`, headers: admin })).json() as CreatorPerformanceDTO;
    expect(perf).toMatchObject({
      posts: 3,
      postsLast90Days: 0,
      medianViews: 1000,
      totalViews: 4500,
      lastPostedAt: kw('2019-03-20T12:00:00').toISOString(),
      campaigns: 1,
      brands: 1,
      rebookRate: 0,
      onTimeRate: 0.5,
      averageDelayDays: 3,
      paid: [{ currency: 'KWD', amount: 300 }],
      costPerView: { currency: 'KWD', value: 0.066667 },
    });
    expect(perf.byPlatform.map((p) => [p.platform, p.posts, p.medianViews])).toEqual([
      ['INSTAGRAM', 2, 750],
      ['TIKTOK', 1, 3000],
    ]);

    const staffPerf = (await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/performance`, headers: staff.auth })).json() as CreatorPerformanceDTO;
    expect(staffPerf.paid).toBeNull();
    expect(staffPerf.costPerView).toBeNull();
  });

  it('the leaderboard ranks by results and reliability, not volume alone', async () => {
    const board = (await app.inject({ method: 'GET', url: `/api/v1/reports/leaderboard?brandId=${brandId}`, headers: admin })).json() as CreatorLeaderboardDTO;
    const e = board.entries.find((x) => x.influencerId === influencerId)!;
    expect(e).toMatchObject({ deliverablesPublished: 2, medianViews: 1000, onTimeRate: 0.5, tier: 'SILVER' });
    // 2×4 + 1×3 + 0×4 + 0.5×20 + log10(1001)×6 = 39
    expect(e.score).toBe(39);
  });
});
