import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { pruneHistory } from '@influenceos/domain';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P2.8 — a post's newest numbers come from its latest-snapshot pointer (kept
 * current by the database), and old history is thinned: routine checks go
 * after 30 days, failures after 180, status changes stay; snapshots older
 * than 30 days keep the last one of each Kuwait day.
 */
const DAY = 24 * 60 * 60 * 1000;

describe('P2.8 — latest snapshot pointer and history retention', () => {
  let app: FastifyInstance;
  let adminId: string;
  let api: Awaited<ReturnType<typeof clientFor>>;
  let prisma: import('@influenceos/database').PrismaClient;
  const tag = `P28R${Date.now()}`;
  let contentId: string;
  let accountId: string;
  let influencerId: string;
  const now = new Date();
  const ago = (days: number, hour = 12) => {
    const d = new Date(now.getTime() - days * DAY);
    d.setUTCHours(hour - 3, 0, 0, 0); // `hour` o'clock in Kuwait
    return d;
  };

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    adminId = a.userId;
    api = await clientFor(app, a.auth);
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    influencerId = (await prisma.influencer.create({ data: { displayName: `${tag} Creator`, countryCode: 'KW' } })).id;
    accountId = (
      await prisma.socialAccount.create({ data: { influencerId, platform: 'INSTAGRAM', username: tag.toLowerCase() } })
    ).id;
    contentId = (
      await prisma.publishedContent.create({
        data: { platform: 'INSTAGRAM', originalUrl: `https://example.test/${tag}`, influencerId, detectedAt: ago(60) },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.publishedContent.deleteMany({ where: { id: contentId } });
    await prisma.influencer.deleteMany({ where: { id: influencerId } });
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
  });

  it('the newest snapshot is what the post shows, however snapshots arrive', async () => {
    const snap = (views: number, capturedAt: Date) =>
      prisma.contentMetricSnapshot.create({ data: { publishedContentId: contentId, views, capturedAt } });
    await snap(100, ago(2));
    expect((await api.content.get(contentId)).metrics?.views).toBe(100);
    await snap(50, ago(5)); // an older one arriving later changes nothing
    expect((await api.content.get(contentId)).metrics?.views).toBe(100);
    const newest = await snap(300, ago(0, 9));
    expect((await api.content.get(contentId)).metrics?.views).toBe(300);
    await prisma.contentMetricSnapshot.delete({ where: { id: newest.id } });
    expect((await api.content.get(contentId)).metrics?.views).toBe(100);
  });

  it('old history is thinned; recent history and status changes stay', async () => {
    // Three snapshots on one old Kuwait day, two on another, and the recent ones above.
    for (const [days, hour, views] of [
      [40, 9, 1],
      [40, 15, 2],
      [40, 23, 3],
      [41, 1, 4],
      [41, 20, 5],
    ] as const) {
      await prisma.contentMetricSnapshot.create({ data: { publishedContentId: contentId, views, capturedAt: ago(days, hour) } });
    }
    for (const [days, hour] of [
      [40, 8],
      [40, 22],
      [3, 8],
      [3, 20],
    ] as const) {
      await prisma.socialMetricSnapshot.create({ data: { socialAccountId: accountId, followers: 1000 + hour, capturedAt: ago(days, hour) } });
    }
    const event = (type: 'CHECK_OK' | 'CHECK_FAILED' | 'STATUS_CHANGED', days: number) =>
      prisma.contentMonitoringEvent.create({ data: { publishedContentId: contentId, type, checkedAt: ago(days), success: type !== 'CHECK_FAILED' } });
    await event('CHECK_OK', 40);
    await event('CHECK_OK', 10);
    await event('CHECK_FAILED', 40);
    await event('CHECK_FAILED', 200);
    await event('STATUS_CHANGED', 400);

    // Drain whatever else is due in this database first, then check ours.
    for (let i = 0; i < 20; i++) {
      const r = await pruneHistory(prisma, now);
      if (r.checkEvents + r.contentSnapshots + r.followerSnapshots === 0) break;
    }

    const views = (await prisma.contentMetricSnapshot.findMany({ where: { publishedContentId: contentId }, orderBy: { capturedAt: 'asc' } })).map(
      (s) => s.views,
    );
    // Day 41 keeps its last (5), day 40 its last (3); the recent 50 and 100 stay.
    expect(views).toEqual([5, 3, 50, 100]);
    const followers = (await prisma.socialMetricSnapshot.findMany({ where: { socialAccountId: accountId }, orderBy: { capturedAt: 'asc' } })).map(
      (s) => s.followers,
    );
    expect(followers).toEqual([1022, 1008, 1020]);
    const events = (await prisma.contentMonitoringEvent.findMany({ where: { publishedContentId: contentId }, orderBy: { checkedAt: 'asc' } })).map(
      (e) => e.type,
    );
    expect(events).toEqual(['STATUS_CHANGED', 'CHECK_FAILED', 'CHECK_OK']);
    // The post still shows its newest numbers.
    expect((await api.content.get(contentId)).metrics?.views).toBe(100);
  });
});
