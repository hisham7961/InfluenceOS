import type { Platform, PrismaClient } from '@influenceos/database';

/**
 * P2.4 — problems nobody would otherwise notice until a client asks: a
 * provider sync that keeps failing, or background jobs that gave up. They
 * reach the admins as in-app notifications (and from there any other channel
 * notifications go out on), at most once per `dedupeHours` per problem.
 */

export interface AdminAlert {
  /** Also the de-duplication key: the same title isn't sent twice in the window. */
  title: string;
  body: string;
  targetUrl?: string;
  dedupeHours?: number;
}

/** Notify every active admin. Returns how many notifications were created. */
export async function alertAdmins(prisma: PrismaClient, alert: AdminAlert, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - (alert.dedupeHours ?? 24) * 3600_000);
  const admins = await prisma.user.findMany({
    where: { isActive: true, OR: [{ role: 'ADMIN' }, { roleProfile: 'ADMIN' }] },
    select: { id: true },
  });
  let created = 0;
  for (const admin of admins) {
    const recent = await prisma.notification.findFirst({
      where: { userId: admin.id, category: 'SYNC_FAILURE', title: alert.title, createdAt: { gte: since } },
      select: { id: true },
    });
    if (recent) continue;
    await prisma.notification.create({
      data: {
        category: 'SYNC_FAILURE',
        title: alert.title,
        body: alert.body,
        targetUrl: alert.targetUrl ?? null,
        userId: admin.id,
        deliveries: { create: { channel: 'IN_APP', status: 'SENT', deliveredAt: now } },
      },
    });
    created++;
  }
  return created;
}

export interface PlatformSyncHealth {
  platform: Platform;
  failures: number;
  successes: number;
  failing: boolean;
}

/** Failed attempts with no success in the window before a platform counts as failing. */
export const SYNC_FAILURE_THRESHOLD = 3;

/**
 * Look at the last day of follower syncs per platform and record it on the
 * platform's integration settings (last success, last error) so Admin →
 * Integrations shows the truth. A platform whose syncs all failed
 * (at least SYNC_FAILURE_THRESHOLD of them) alerts the admins.
 */
export async function recordSyncHealth(prisma: PrismaClient, now = new Date()): Promise<PlatformSyncHealth[]> {
  const since = new Date(now.getTime() - 24 * 3600_000);
  const [failed, succeeded] = await Promise.all([
    prisma.socialAccount.groupBy({
      by: ['platform'],
      where: { lastSyncAttemptAt: { gte: since }, lastSyncError: { not: null } },
      _count: { _all: true },
    }),
    prisma.socialAccount.groupBy({
      by: ['platform'],
      where: { lastSyncedAt: { gte: since } },
      _count: { _all: true },
      _max: { lastSyncedAt: true },
    }),
  ]);
  const platforms = new Set<Platform>([...failed.map((f) => f.platform), ...succeeded.map((s) => s.platform)]);
  const out: PlatformSyncHealth[] = [];
  for (const platform of platforms) {
    const failures = failed.find((f) => f.platform === platform)?._count._all ?? 0;
    const ok = succeeded.find((s) => s.platform === platform);
    const successes = ok?._count._all ?? 0;
    const failing = successes === 0 && failures >= SYNC_FAILURE_THRESHOLD;
    out.push({ platform, failures, successes, failing });

    if (successes > 0) {
      await prisma.integrationSetting.upsert({
        where: { platform },
        update: { lastSuccessAt: ok!._max.lastSyncedAt, ...(failures === 0 ? { lastError: null } : {}) },
        create: { platform, status: 'NOT_CONFIGURED', lastSuccessAt: ok!._max.lastSyncedAt },
      });
    }
    if (failing) {
      const latest = await prisma.socialAccount.findFirst({
        where: { platform, lastSyncAttemptAt: { gte: since }, lastSyncError: { not: null } },
        orderBy: { lastSyncAttemptAt: 'desc' },
        select: { lastSyncError: true },
      });
      const reason = latest?.lastSyncError ?? 'unknown error';
      await prisma.integrationSetting.upsert({
        where: { platform },
        update: { lastError: `Follower sync is failing: ${reason}`.slice(0, 500) },
        create: { platform, status: 'NOT_CONFIGURED', lastError: `Follower sync is failing: ${reason}`.slice(0, 500) },
      });
      await alertAdmins(
        prisma,
        {
          title: `${platform} sync is failing`,
          body: `${failures} follower syncs failed in the last 24 hours and none succeeded. Last error: ${reason}`.slice(0, 1000),
          targetUrl: '/settings/integrations',
        },
        now,
      );
    }
  }
  return out;
}
