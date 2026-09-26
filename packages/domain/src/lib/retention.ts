import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';

/**
 * Keeps the history tables from growing without limit (P2.8):
 *
 * - Routine "check OK" events are deleted after 30 days, failed and
 *   rate-limited checks after 180 days. Status changes (a post taken down,
 *   back up) are kept for good.
 * - Post metric snapshots and follower snapshots older than 30 days are
 *   thinned to the last one of each Kuwait day. Charts keep their shape; the
 *   newest snapshot of a post is never touched.
 *
 * Each call removes at most `batch` rows per table, so a big backlog drains
 * over several runs instead of one long lock.
 */
export const RETENTION = {
  routineCheckDays: 30,
  failedCheckDays: 180,
  thinSnapshotsAfterDays: 30,
} as const;

export interface PruneResult {
  checkEvents: number;
  contentSnapshots: number;
  followerSnapshots: number;
}

const DAY = 24 * 60 * 60 * 1000;

export async function pruneHistory(prisma: DomainContext['prisma'], now: Date = new Date(), batch = 5000): Promise<PruneResult> {
  const routineBefore = new Date(now.getTime() - RETENTION.routineCheckDays * DAY);
  const failedBefore = new Date(now.getTime() - RETENTION.failedCheckDays * DAY);
  const thinBefore = new Date(now.getTime() - RETENTION.thinSnapshotsAfterDays * DAY);

  const checkEvents = await prisma.$executeRaw`
    DELETE FROM "ContentMonitoringEvent"
     WHERE "id" IN (
       SELECT "id" FROM "ContentMonitoringEvent"
        WHERE ("type" = 'CHECK_OK' AND "checkedAt" < ${routineBefore})
           OR ("type" IN ('CHECK_FAILED', 'RATE_LIMITED') AND "checkedAt" < ${failedBefore})
        LIMIT ${batch})`;

  // Timestamps are stored in UTC; a "day" is a Kuwait calendar day.
  const kuwaitDay = (col: string) => Prisma.raw(`date_trunc('day', ("${col}" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kuwait')`);

  const contentSnapshots = await prisma.$executeRaw`
    DELETE FROM "ContentMetricSnapshot"
     WHERE "id" IN (
       SELECT x."id" FROM (
         SELECT "id", row_number() OVER (
                  PARTITION BY "publishedContentId", ${kuwaitDay('capturedAt')}
                  ORDER BY "capturedAt" DESC, "id" DESC) AS rn
           FROM "ContentMetricSnapshot"
          WHERE "capturedAt" < ${thinBefore}
       ) x
       WHERE x.rn > 1
         AND NOT EXISTS (SELECT 1 FROM "PublishedContent" pc WHERE pc."latestSnapshotId" = x."id")
       LIMIT ${batch})`;

  const followerSnapshots = await prisma.$executeRaw`
    DELETE FROM "SocialMetricSnapshot"
     WHERE "id" IN (
       SELECT x."id" FROM (
         SELECT "id", row_number() OVER (
                  PARTITION BY "socialAccountId", ${kuwaitDay('capturedAt')}
                  ORDER BY "capturedAt" DESC, "id" DESC) AS rn
           FROM "SocialMetricSnapshot"
          WHERE "capturedAt" < ${thinBefore}
       ) x
       WHERE x.rn > 1
       LIMIT ${batch})`;

  return { checkEvents, contentSnapshots, followerSnapshots };
}
