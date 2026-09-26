import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@influenceos/database';
import {
  claimDueContent,
  claimStaleAccounts,
  countDueContent,
  createServices,
  systemContext,
} from '@influenceos/domain';

/**
 * P0.3 — background monitoring must keep moving through the whole backlog.
 *
 * Before: every sweep re-selected the same head-of-queue rows (nothing was
 * claimed), a switched-off platform's rows were filtered out *after* the
 * LIMIT so they could fill the batch forever, Stories (no public URL) were
 * always first in line, and an account the provider kept rejecting was
 * re-picked ahead of healthy ones every sweep.
 *
 * The claims run against the shared test database, so assertions only look at
 * this file's own rows; `now` is pinned in the past so rows created elsewhere
 * with a real "due now" timestamp stay out of the way.
 */
describe('P0.3 — monitoring schedule claims', () => {
  let prisma: PrismaClient;
  const tag = `mon${Date.now()}`;
  const now = new Date('2001-01-01T00:00:00Z');
  const before = (h: number) => new Date(now.getTime() - h * 3600e3);

  let influencerId: string;
  let ytOld: string;
  let ytNewer: string;
  let ytFuture: string;
  let ytRemoved: string;
  let story: string;
  let snapOld: string[] = [];
  let snapSetting: { existed: boolean; isEnabled: boolean; monitoringEnabled: boolean };

  const content = (platform: 'YOUTUBE' | 'SNAPCHAT', suffix: string, data: Record<string, unknown>) =>
    prisma.publishedContent
      .create({
        data: {
          platform,
          originalUrl: `https://example.com/${tag}/${suffix}`,
          availabilityStatus: 'LIVE',
          dataSource: 'MANUAL',
          influencerId,
          ...data,
        },
        select: { id: true },
      })
      .then((r) => r.id);

  beforeAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    influencerId = (
      await prisma.influencer.create({ data: { displayName: `${tag} Creator`, countryCode: 'KW' }, select: { id: true } })
    ).id;

    // Snapchat rows are the most overdue — they'd fill the whole batch if the
    // platform filter ran after the LIMIT.
    snapOld = await Promise.all(
      [1, 2, 3].map((i) => content('SNAPCHAT', `snap${i}`, { nextCheckAt: before(1000 + i) })),
    );
    ytOld = await content('YOUTUBE', 'old', { nextCheckAt: before(48) });
    ytNewer = await content('YOUTUBE', 'newer', { nextCheckAt: before(2) });
    ytFuture = await content('YOUTUBE', 'future', { nextCheckAt: new Date(now.getTime() + 3600e3) });
    ytRemoved = await content('YOUTUBE', 'removed', { nextCheckAt: before(5), availabilityStatus: 'REMOVED' });
    story = await content('YOUTUBE', 'story', { nextCheckAt: null, isStory: true });

    const existing = await prisma.integrationSetting.findUnique({ where: { platform: 'SNAPCHAT' } });
    snapSetting = {
      existed: !!existing,
      isEnabled: existing?.isEnabled ?? true,
      monitoringEnabled: existing?.monitoringEnabled ?? true,
    };
    await prisma.integrationSetting.upsert({
      where: { platform: 'SNAPCHAT' },
      create: { platform: 'SNAPCHAT', monitoringEnabled: false },
      update: { monitoringEnabled: false },
    });
  });

  afterAll(async () => {
    if (snapSetting.existed) {
      await prisma.integrationSetting.update({
        where: { platform: 'SNAPCHAT' },
        data: { isEnabled: snapSetting.isEnabled, monitoringEnabled: snapSetting.monitoringEnabled },
      });
    } else {
      await prisma.integrationSetting.delete({ where: { platform: 'SNAPCHAT' } }).catch(() => undefined);
    }
    await prisma.publishedContent.deleteMany({ where: { originalUrl: { startsWith: `https://example.com/${tag}/` } } });
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('claims every due row on enabled platforms, skipping stories, removed and switched-off platforms', async () => {
    // A batch exactly the size of the due backlog: if the switched-off
    // platform's rows took up slots, the YouTube rows would miss out.
    const due = await countDueContent(prisma, now);
    const claimed = await claimDueContent(prisma, due, now);

    expect(claimed).toEqual(expect.arrayContaining([ytOld, ytNewer]));
    expect(claimed.indexOf(ytOld)).toBeLessThan(claimed.indexOf(ytNewer)); // oldest-due first
    for (const id of [...snapOld, ytFuture, ytRemoved, story]) expect(claimed).not.toContain(id);
  });

  it('does not hand the same rows to the next sweep while the claim is live', async () => {
    const again = await claimDueContent(prisma, 10_000, now);
    expect(again).not.toContain(ytOld);
    expect(again).not.toContain(ytNewer);

    const lease = await prisma.publishedContent.findUnique({ where: { id: ytOld }, select: { nextCheckAt: true } });
    expect(lease?.nextCheckAt?.getTime()).toBeGreaterThan(now.getTime());

    // …and a claim that never completed comes back once its lease runs out.
    const later = await claimDueContent(prisma, 10_000, new Date(now.getTime() + 2 * 3600e3));
    expect(later).toEqual(expect.arrayContaining([ytOld, ytNewer, ytFuture]));
  });

  it('never probes a Story on refresh', async () => {
    const services = createServices({ ...systemContext(prisma), credentials: {} });
    await services.content.refresh(story);
    expect(await prisma.contentMonitoringEvent.count({ where: { publishedContentId: story } })).toBe(0);
  });

  it('returns the newest 200 metric snapshots, oldest first', async () => {
    const base = Date.now() - 300 * 3600e3;
    await prisma.contentMetricSnapshot.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        publishedContentId: ytOld,
        views: i,
        source: 'MANUAL' as const,
        capturedAt: new Date(base + i * 3600e3),
      })),
    });
    const { makeApp, loginFresh, deleteUser } = await import('../helpers.ts');
    const app = await makeApp();
    const { auth, userId } = await loginFresh(app);
    try {
      const res = await app.inject({ method: 'GET', url: `/api/v1/content/${ytOld}/metrics`, headers: auth });
      expect(res.statusCode).toBe(200);
      const points = res.json() as { views: number | null }[];
      expect(points).toHaveLength(200);
      expect(points[0]!.views).toBe(5);
      expect(points[199]!.views).toBe(204);
    } finally {
      await deleteUser(userId);
      await app.close();
    }
  });
});

describe('P0.3 — follower sync claims back off failing accounts', () => {
  let prisma: PrismaClient;
  const tag = `acct${Date.now()}`;
  const now = new Date();
  const before = (h: number) => new Date(now.getTime() - h * 3600e3);
  let influencerId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    influencerId = (
      await prisma.influencer.create({ data: { displayName: `${tag} Creator`, countryCode: 'KW' }, select: { id: true } })
    ).id;
    const make = async (key: string, platform: 'YOUTUBE' | 'TIKTOK', data: Record<string, unknown>) => {
      ids[key] = (
        await prisma.socialAccount.create({
          data: { influencerId, platform, username: `${tag}_${key}`, ...data },
          select: { id: true },
        })
      ).id;
    };
    await make('neverSynced', 'YOUTUBE', {});
    await make('stale', 'YOUTUBE', { lastSyncedAt: before(48), lastSyncAttemptAt: before(48) });
    await make('justFailed', 'YOUTUBE', { lastSyncedAt: before(48), lastSyncAttemptAt: before(1) });
    await make('fresh', 'YOUTUBE', { lastSyncedAt: before(1), lastSyncAttemptAt: before(1) });
    await make('otherPlatform', 'TIKTOK', {});
  });

  afterAll(async () => {
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('claims stale accounts once, skipping fresh, recently-failed and unsupported-platform ones', async () => {
    const claimed = await claimStaleAccounts(prisma, 10_000, ['YOUTUBE'], now);
    expect(claimed).toEqual(expect.arrayContaining([ids.neverSynced, ids.stale]));
    for (const k of ['justFailed', 'fresh', 'otherPlatform']) expect(claimed).not.toContain(ids[k]);

    const again = await claimStaleAccounts(prisma, 10_000, ['YOUTUBE'], now);
    expect(again).not.toContain(ids.neverSynced);
    expect(again).not.toContain(ids.stale);

    // Retried after the back-off window.
    const later = await claimStaleAccounts(prisma, 10_000, ['YOUTUBE'], new Date(now.getTime() + 7 * 3600e3));
    expect(later).toEqual(expect.arrayContaining([ids.neverSynced, ids.stale, ids.justFailed]));
  });

  it('records why a sync failed without marking the account as synced', async () => {
    const services = createServices({ ...systemContext(prisma), credentials: {} });
    const res = await services.socialAccounts.sync(ids.neverSynced!);
    expect(res.synced).toBe(false);
    const row = await prisma.socialAccount.findUnique({
      where: { id: ids.neverSynced },
      select: { lastSyncedAt: true, lastSyncAttemptAt: true, lastSyncError: true },
    });
    expect(row?.lastSyncedAt).toBeNull();
    expect(row?.lastSyncAttemptAt).not.toBeNull();
    expect(row?.lastSyncError).toBeTruthy();
  });
});
