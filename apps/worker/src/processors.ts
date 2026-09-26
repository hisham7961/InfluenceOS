import { prisma, type Platform } from '@influenceos/database';
import {
  claimDueContent,
  claimStaleAccounts,
  countDueContent,
  countStaleAccounts,
  createNotification,
  createServices,
  systemContext,
  type UploadCleanupResult,
} from '@influenceos/domain';
import { USAGE_RIGHT_EXPIRY_WARNING_DAYS, daysUntilExpiry } from '@influenceos/shared';

const OPEN_DELIVERABLE = ['PLANNED', 'SENT_TO_INFLUENCER', 'AWAITING_PUBLICATION'] as const;

/** Availability + metric refresh for one piece of content (domain logic). */
export async function checkContent(id: string): Promise<void> {
  const services = createServices(systemContext());
  await services.content.refresh(id);
}

/** Follower/metric sync for one social account (no-ops without an API key). */
export async function syncAccount(id: string): Promise<void> {
  const services = createServices(systemContext());
  await services.socialAccounts.sync(id);
}

/** Quarantine stored files no record references (see the service for the
 *  safety guards). A 24h grace window means an in-flight upload is never touched. */
export async function cleanupAbandonedUploads(): Promise<UploadCleanupResult> {
  const services = createServices(systemContext());
  return services.attachments.cleanupAbandonedUploads();
}

/** Claim the next batch of content due for a check (see monitoring-schedule). */
export async function claimDueContentIds(limit: number): Promise<string[]> {
  return claimDueContent(prisma, limit);
}

/**
 * Platforms whose follower sync actually runs with the credentials configured
 * right now — creator-authorization and manual-only platforms would fail every
 * time, so they are never queued.
 */
export function followerSyncPlatforms(): Platform[] {
  const services = createServices(systemContext());
  return services.providers
    .capabilities()
    .filter((c) => c.apiConfigured && (c.followerSync === 'YES_WITH_API' || c.followerSync === 'CONDITIONAL'))
    .map((c) => c.platform);
}

/** Claim the next batch of accounts whose follower counts are over a day old. */
export async function claimStaleAccountIds(limit: number): Promise<string[]> {
  const platforms = followerSyncPlatforms();
  return platforms.length ? claimStaleAccounts(prisma, limit, platforms) : [];
}

/** Work still waiting after a sweep — surfaced on /health so a stall is visible. */
export async function monitoringBacklog(): Promise<{ dueContent: number; staleAccounts: number }> {
  const [dueContent, staleAccounts] = await Promise.all([
    countDueContent(prisma),
    countStaleAccounts(prisma, followerSyncPlatforms()),
  ]);
  return { dueContent, staleAccounts };
}

/** Generate deliverable/campaign notifications (deduped within ~20h). */
export async function generateNotifications(): Promise<{ created: number }> {
  const ctx = systemContext();
  const now = new Date();
  const soon = new Date(now.getTime() + 2 * 864e5);
  const ending = new Date(now.getTime() + 3 * 864e5);
  const dedupeSince = new Date(now.getTime() - 20 * 3600 * 1000);
  let created = 0;

  async function once(category: Parameters<typeof createNotification>[1]['category'], campaignId: string): Promise<boolean> {
    const existing = await prisma.notification.findFirst({ where: { category, campaignId, createdAt: { gte: dedupeSince } } });
    return !existing;
  }

  // Reminders are routed to the campaign owner when one is set (W4-5), so the
  // person accountable for the work is the one who gets pinged; otherwise the
  // notification is a workspace-wide broadcast as before.
  const campaignSelect = { name: true, brandId: true, ownerId: true } as const;

  const overdue = await prisma.deliverable.findMany({
    where: { dueDate: { lt: now }, status: { in: [...OPEN_DELIVERABLE] } },
    include: { campaignInfluencer: { select: { campaignId: true, campaign: { select: campaignSelect } } } },
    take: 100,
  });
  const overdueSeen = new Set<string>();
  for (const d of overdue) {
    const campaignId = d.campaignInfluencer.campaignId;
    if (overdueSeen.has(campaignId)) continue;
    overdueSeen.add(campaignId);
    if (!(await once('DELIVERABLE_OVERDUE', campaignId))) continue;
    await createNotification(ctx, {
      category: 'DELIVERABLE_OVERDUE',
      title: 'Deliverable overdue',
      body: `A deliverable in ${d.campaignInfluencer.campaign.name} is past its due date.`,
      targetUrl: `/campaigns/${campaignId}`,
      campaignId,
      brandId: d.campaignInfluencer.campaign.brandId,
      userId: d.campaignInfluencer.campaign.ownerId,
    });
    created++;
  }

  const dueSoon = await prisma.deliverable.findMany({
    where: { dueDate: { gte: now, lte: soon }, status: { in: [...OPEN_DELIVERABLE] } },
    include: { campaignInfluencer: { select: { campaignId: true, campaign: { select: campaignSelect } } } },
    take: 100,
  });
  const soonSeen = new Set<string>();
  for (const d of dueSoon) {
    const campaignId = d.campaignInfluencer.campaignId;
    if (soonSeen.has(campaignId)) continue;
    soonSeen.add(campaignId);
    if (!(await once('DELIVERABLE_DUE_SOON', campaignId))) continue;
    await createNotification(ctx, {
      category: 'DELIVERABLE_DUE_SOON',
      title: 'Deliverable due soon',
      body: `A deliverable in ${d.campaignInfluencer.campaign.name} is due within 48 hours.`,
      targetUrl: `/campaigns/${campaignId}`,
      campaignId,
      brandId: d.campaignInfluencer.campaign.brandId,
      userId: d.campaignInfluencer.campaign.ownerId,
    });
    created++;
  }

  const endingCampaigns = await prisma.campaign.findMany({
    where: { status: 'ACTIVE', endDate: { gte: now, lte: ending } },
    select: { id: true, name: true, brandId: true, ownerId: true },
    take: 50,
  });
  for (const c of endingCampaigns) {
    if (!(await once('CAMPAIGN_ENDING', c.id))) continue;
    await createNotification(ctx, {
      category: 'CAMPAIGN_ENDING',
      title: 'Campaign ending soon',
      body: `${c.name} ends within 3 days.`,
      targetUrl: `/campaigns/${c.id}`,
      campaignId: c.id,
      brandId: c.brandId,
      userId: c.ownerId,
    });
    created++;
  }

  // --- Usage-rights license expiry (W3-2) ----------------------------------
  // 1. Housekeeping: mark ACTIVE licenses whose expiry has passed as EXPIRED so
  //    the stored ledger stays truthful (the DTO derives EXPIRED on read too,
  //    but reports/queries filter on the stored column).
  await prisma.usageRight.updateMany({
    where: { status: 'ACTIVE', expiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });

  // 2. Alert on ACTIVE licenses inside the expiry-warning window so ad spend is
  //    never planned on rights about to lapse. Deduped per-license by targetUrl.
  const warnBy = new Date(now.getTime() + USAGE_RIGHT_EXPIRY_WARNING_DAYS * 864e5);
  const expiring = await prisma.usageRight.findMany({
    where: { status: 'ACTIVE', expiresAt: { gte: now, lte: warnBy } },
    include: { brand: { select: { name: true } } },
    orderBy: { expiresAt: 'asc' },
    take: 100,
  });
  for (const ur of expiring) {
    const targetUrl = `/brands/${ur.brandId}/usage-rights/${ur.id}`;
    const already = await prisma.notification.findFirst({
      where: { category: 'USAGE_RIGHT_EXPIRING', targetUrl, createdAt: { gte: dedupeSince } },
      select: { id: true },
    });
    if (already) continue;
    const days = daysUntilExpiry(ur.expiresAt, now) ?? 0;
    await createNotification(ctx, {
      category: 'USAGE_RIGHT_EXPIRING',
      title: 'Usage rights expiring soon',
      body: `A ${ur.usageType.replace(/_/g, ' ').toLowerCase()} usage right for ${ur.brand.name} expires in ${days} day${days === 1 ? '' : 's'}.`,
      targetUrl,
      brandId: ur.brandId,
      campaignId: ur.campaignId,
      influencerId: ur.influencerId,
      publishedContentId: ur.publishedContentId,
    });
    created++;
  }

  return { created };
}
