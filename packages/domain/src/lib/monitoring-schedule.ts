import type { Platform, Prisma, PrismaClient } from '@influenceos/database';

/**
 * Background-monitoring scheduler: decides which content to re-check and which
 * social accounts to re-sync on each worker sweep.
 *
 * Every pick is a *claim* — the chosen rows are pushed forward in time as part
 * of the same sweep, so the next sweep moves on to the rest of the backlog
 * instead of re-offering the same head-of-queue rows. A claim that never
 * completes (worker crash, lost job) simply expires and the row comes back.
 */

/** How long a claimed content check stays out of the queue before it is re-offered. */
export const CONTENT_CLAIM_LEASE_MS = 60 * 60 * 1000;
/** An account is due for a follower sync once its last success is this old. */
export const ACCOUNT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Minimum gap between two sync attempts on one account (success or failure). */
export const ACCOUNT_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Platforms whose content checks are switched off in Admin → Integrations.
 * A platform with no settings row has never been touched and is on by default.
 */
async function monitoringOffPlatforms(prisma: PrismaClient): Promise<Platform[]> {
  const rows = await prisma.integrationSetting.findMany({
    where: { OR: [{ isEnabled: false }, { monitoringEnabled: false }] },
    select: { platform: true },
  });
  return rows.map((r) => r.platform);
}

function dueContentWhere(now: Date, off: Platform[]): Prisma.PublishedContentWhereInput {
  return {
    // Stories are uploaded files with no public URL to check.
    isStory: false,
    availabilityStatus: { notIn: ['REMOVED'] },
    ...(off.length > 0 ? { platform: { notIn: off } } : {}),
    OR: [{ nextCheckAt: { lte: now } }, { nextCheckAt: null }],
  };
}

/** Content currently waiting for a check (for health/backlog reporting). */
export async function countDueContent(prisma: PrismaClient, now = new Date()): Promise<number> {
  return prisma.publishedContent.count({ where: dueContentWhere(now, await monitoringOffPlatforms(prisma)) });
}

/**
 * Claim up to `limit` pieces of content that are due for an availability and
 * metrics check, oldest-due first. Platform filtering happens in the query so
 * a switched-off platform can never crowd the rest out of the batch.
 */
export async function claimDueContent(prisma: PrismaClient, limit: number, now = new Date()): Promise<string[]> {
  const rows = await prisma.publishedContent.findMany({
    where: dueContentWhere(now, await monitoringOffPlatforms(prisma)),
    orderBy: [{ nextCheckAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: limit,
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await prisma.publishedContent.updateMany({
      where: { id: { in: ids } },
      data: { nextCheckAt: new Date(now.getTime() + CONTENT_CLAIM_LEASE_MS) },
    });
  }
  return ids;
}

async function staleAccountWhere(
  prisma: PrismaClient,
  platforms: Platform[],
  now: Date,
): Promise<Prisma.SocialAccountWhereInput | null> {
  const off = new Set(
    (await prisma.integrationSetting.findMany({ where: { isEnabled: false }, select: { platform: true } })).map(
      (r) => r.platform,
    ),
  );
  const active = platforms.filter((p) => !off.has(p));
  if (active.length === 0) return null;
  return {
    platform: { in: active },
    AND: [
      { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lte: new Date(now.getTime() - ACCOUNT_STALE_AFTER_MS) } }] },
      {
        OR: [
          { lastSyncAttemptAt: null },
          { lastSyncAttemptAt: { lte: new Date(now.getTime() - ACCOUNT_RETRY_AFTER_MS) } },
        ],
      },
    ],
  };
}

/** Accounts currently waiting for a follower sync on `platforms`. */
export async function countStaleAccounts(
  prisma: PrismaClient,
  platforms: Platform[],
  now = new Date(),
): Promise<number> {
  const where = await staleAccountWhere(prisma, platforms, now);
  return where ? prisma.socialAccount.count({ where }) : 0;
}

/**
 * Claim up to `limit` accounts on `platforms` (those whose follower sync
 * actually works with the configured credentials) whose last successful sync
 * is over a day old. The attempt is stamped on claim, so an account the
 * provider keeps rejecting is retried every few hours instead of holding the
 * front of the queue on every sweep.
 */
export async function claimStaleAccounts(
  prisma: PrismaClient,
  limit: number,
  platforms: Platform[],
  now = new Date(),
): Promise<string[]> {
  const where = await staleAccountWhere(prisma, platforms, now);
  if (!where) return [];
  const rows = await prisma.socialAccount.findMany({
    where,
    orderBy: [
      { lastSyncAttemptAt: { sort: 'asc', nulls: 'first' } },
      { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
      { id: 'asc' },
    ],
    take: limit,
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await prisma.socialAccount.updateMany({ where: { id: { in: ids } }, data: { lastSyncAttemptAt: now } });
  }
  return ids;
}
