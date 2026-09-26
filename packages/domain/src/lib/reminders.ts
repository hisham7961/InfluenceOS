import type { NotificationCategory } from '@influenceos/contracts';
import {
  USAGE_RIGHT_EXPIRY_WARNING_DAYS,
  appRoutes,
  businessDateKey,
  businessDaysBetween,
  daysUntilExpiry,
} from '@influenceos/shared';
import type { DomainContext } from '../context';
import { dueWithinWhere, overdueWhere } from './deliverable-rules';
import { createNotification } from './helpers';

/**
 * The reminders the worker sends (P2.6) — deadlines, campaigns ending and
 * usage rights expiring. They live here (not in the worker) so they are
 * tested with the rest of the business rules.
 *
 * Deliverables: one reminder per deliverable naming the creator and what is
 * owed, to the campaign's owner and the creator's owner (both, once each).
 * Nobody owns either → the whole team (in the campaign's brand) sees it.
 * Several for the same person on one campaign are grouped into one line.
 * An overdue one is repeated every few days while it stays overdue, and
 * reminded again if its due date moves. "Outstanding" is the shared rule:
 * drafts in review, changes requested and approved-but-not-posted work all
 * count.
 */
export const OVERDUE_REPEAT_DAYS = 3;
const DAY = 864e5;

type Row = {
  id: string;
  type: string;
  dueDate: Date | null;
  overdueRemindedAt: Date | null;
  dueSoonRemindedAt: Date | null;
  campaignInfluencer: {
    campaignId: string;
    campaign: { name: string; brandId: string; ownerId: string | null };
    influencer: { id: string; displayName: string; ownerId: string | null };
  };
};

const rowSelect = {
  id: true,
  type: true,
  dueDate: true,
  overdueRemindedAt: true,
  dueSoonRemindedAt: true,
  campaignInfluencer: {
    select: {
      campaignId: true,
      campaign: { select: { name: true, brandId: true, ownerId: true } },
      influencer: { select: { id: true, displayName: true, ownerId: true } },
    },
  },
} as const;

/** Who is told about a deliverable: its campaign's owner and its creator's owner, or everyone. */
function recipientsOf(r: Row): (string | null)[] {
  const ids = [r.campaignInfluencer.campaign.ownerId, r.campaignInfluencer.influencer.ownerId].filter(
    (x): x is string => !!x,
  );
  return ids.length ? [...new Set(ids)] : [null];
}

/** Group rows per (recipient, campaign). */
function groupRows(rows: Row[]): Map<string, { userId: string | null; rows: Row[] }> {
  const groups = new Map<string, { userId: string | null; rows: Row[] }>();
  for (const r of rows) {
    for (const userId of recipientsOf(r)) {
      const key = `${userId ?? '*'}|${r.campaignInfluencer.campaignId}`;
      const g = groups.get(key) ?? { userId, rows: [] };
      g.rows.push(r);
      groups.set(key, g);
    }
  }
  return groups;
}

/** The deliverable type as the English word the catalog translates ("Reel"). */
function typeWord(type: string): string {
  const words: Record<string, string> = { LIVE: 'Livestream', TWEET: 'Post (X)', UGC: 'UGC' };
  return words[type] ?? type.charAt(0) + type.slice(1).toLowerCase();
}

export async function runReminders(ctx: DomainContext, now: Date = new Date()): Promise<{ created: number }> {
  const { prisma } = ctx;
  let created = 0;

  // --- Overdue ----------------------------------------------------------------
  const repeatBefore = new Date(now.getTime() - OVERDUE_REPEAT_DAYS * DAY);
  const overdue = (await prisma.deliverable.findMany({
    where: {
      AND: [
        overdueWhere(now),
        {
          OR: [
            { overdueRemindedAt: null },
            { overdueRemindedAt: { lt: repeatBefore } },
            // The due date moved after the last reminder.
            { overdueRemindedAt: { lt: prisma.deliverable.fields.dueDate } },
          ],
        },
      ],
    },
    select: rowSelect,
    orderBy: { dueDate: 'asc' },
    take: 500,
  })) as Row[];
  for (const { userId, rows } of groupRows(overdue).values()) {
    const first = rows[0]!;
    const campaignId = first.campaignInfluencer.campaignId;
    const campaignName = first.campaignInfluencer.campaign.name;
    const single = rows.length === 1;
    const influencerName = first.campaignInfluencer.influencer.displayName;
    const type = typeWord(first.type);
    const count = rows.length;
    await createNotification(ctx, {
      category: 'DELIVERABLE_OVERDUE',
      title: single ? 'Deliverable overdue' : 'Deliverables overdue',
      body: single
        ? `${influencerName}: ${type} for ${campaignName} is past its due date.`
        : `${count} deliverables in ${campaignName} are past their due date.`,
      targetUrl: appRoutes.campaign(campaignId, 'deliverables'),
      campaignId,
      brandId: first.campaignInfluencer.campaign.brandId,
      influencerId: single ? first.campaignInfluencer.influencer.id : null,
      userId,
    });
    created++;
  }
  if (overdue.length) {
    await prisma.deliverable.updateMany({ where: { id: { in: overdue.map((r) => r.id) } }, data: { overdueRemindedAt: now } });
  }

  // --- Due soon (today, tomorrow, the day after — Kuwait days) --------------
  const todayKey = businessDateKey(now);
  const soonCandidates = (await prisma.deliverable.findMany({
    where: dueWithinWhere(2, now),
    select: rowSelect,
    orderBy: { dueDate: 'asc' },
    take: 500,
  })) as Row[];
  // Remind once per due date: skip if reminded within 3 days before this one.
  const dueSoon = soonCandidates.filter(
    (r) => r.dueDate && (!r.dueSoonRemindedAt || r.dueSoonRemindedAt.getTime() < r.dueDate.getTime() - 3 * DAY),
  );
  for (const { userId, rows } of groupRows(dueSoon).values()) {
    const first = rows[0]!;
    const campaignId = first.campaignInfluencer.campaignId;
    const campaignName = first.campaignInfluencer.campaign.name;
    const single = rows.length === 1;
    const influencerName = first.campaignInfluencer.influencer.displayName;
    const type = typeWord(first.type);
    const count = rows.length;
    const days = businessDaysBetween(todayKey, businessDateKey(first.dueDate!));
    await createNotification(ctx, {
      category: 'DELIVERABLE_DUE_SOON',
      title: single ? 'Deliverable due soon' : 'Deliverables due soon',
      body: !single
        ? `${count} deliverables in ${campaignName} are due in the next 2 days.`
        : days <= 0
          ? `${influencerName}: ${type} for ${campaignName} is due today.`
          : days === 1
            ? `${influencerName}: ${type} for ${campaignName} is due tomorrow.`
            : `${influencerName}: ${type} for ${campaignName} is due in ${days} days.`,
      targetUrl: appRoutes.campaign(campaignId, 'deliverables'),
      campaignId,
      brandId: first.campaignInfluencer.campaign.brandId,
      influencerId: single ? first.campaignInfluencer.influencer.id : null,
      userId,
    });
    created++;
  }
  if (dueSoon.length) {
    await prisma.deliverable.updateMany({ where: { id: { in: dueSoon.map((r) => r.id) } }, data: { dueSoonRemindedAt: now } });
  }

  // --- Campaigns ending within 3 days (once per end date) ------------------
  const endingCampaigns = await prisma.campaign.findMany({
    where: { status: 'ACTIVE', endDate: { gte: now, lte: new Date(now.getTime() + 3 * DAY) } },
    select: { id: true, name: true, brandId: true, ownerId: true, endDate: true },
    take: 100,
  });
  for (const c of endingCampaigns) {
    const dedupeKey = `campaign-ending:${c.id}:${c.endDate!.toISOString().slice(0, 10)}`;
    if (await alreadySent(ctx, 'CAMPAIGN_ENDING', dedupeKey)) continue;
    await createNotification(ctx, {
      category: 'CAMPAIGN_ENDING',
      title: 'Campaign ending soon',
      body: `${c.name} ends within 3 days.`,
      targetUrl: appRoutes.campaign(c.id),
      campaignId: c.id,
      brandId: c.brandId,
      userId: c.ownerId,
      dedupeKey,
    });
    created++;
  }

  // --- Usage rights -----------------------------------------------------------
  // Keep the stored ledger truthful: ACTIVE licences past their expiry are
  // EXPIRED (the DTO derives it on read too, but reports filter the column).
  await prisma.usageRight.updateMany({ where: { status: 'ACTIVE', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
  // Warn once per licence and expiry date, so ad spend isn't planned on
  // rights about to lapse; extending a licence warns again next time.
  const expiring = await prisma.usageRight.findMany({
    where: { status: 'ACTIVE', expiresAt: { gte: now, lte: new Date(now.getTime() + USAGE_RIGHT_EXPIRY_WARNING_DAYS * DAY) } },
    include: { brand: { select: { name: true } } },
    orderBy: { expiresAt: 'asc' },
    take: 200,
  });
  for (const ur of expiring) {
    const dedupeKey = `usage-right-expiring:${ur.id}:${ur.expiresAt!.toISOString().slice(0, 10)}`;
    if (await alreadySent(ctx, 'USAGE_RIGHT_EXPIRING', dedupeKey)) continue;
    const days = daysUntilExpiry(ur.expiresAt, now) ?? 0;
    await createNotification(ctx, {
      category: 'USAGE_RIGHT_EXPIRING',
      title: 'Usage rights expiring soon',
      body: `A ${ur.usageType.replace(/_/g, ' ').toLowerCase()} usage right for ${ur.brand.name} expires in ${days} day${days === 1 ? '' : 's'}.`,
      targetUrl: appRoutes.brandUsageRights(ur.brandId),
      brandId: ur.brandId,
      campaignId: ur.campaignId,
      influencerId: ur.influencerId,
      publishedContentId: ur.publishedContentId,
      dedupeKey,
    });
    created++;
  }

  return { created };
}

async function alreadySent(ctx: DomainContext, category: NotificationCategory, dedupeKey: string): Promise<boolean> {
  const existing = await ctx.prisma.notification.findFirst({ where: { category, dedupeKey }, select: { id: true } });
  return !!existing;
}
