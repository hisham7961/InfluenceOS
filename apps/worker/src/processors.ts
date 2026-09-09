import { prisma } from '@influenceos/database';
import { createNotification, createServices, systemContext } from '@influenceos/domain';

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

/** Delete storage objects from uploads that were never completed (orphans).
 *  Idempotent; a 24h grace window means an in-flight upload is never removed. */
export async function cleanupAbandonedUploads(): Promise<number> {
  const services = createServices(systemContext());
  return services.attachments.cleanupAbandonedUploads();
}

/** Content whose next scheduled check is due, filtered by monitoring settings. */
export async function findDueContentIds(limit: number): Promise<string[]> {
  const now = new Date();
  const rows = await prisma.publishedContent.findMany({
    where: {
      availabilityStatus: { notIn: ['REMOVED'] },
      OR: [{ nextCheckAt: { lte: now } }, { nextCheckAt: null }],
    },
    orderBy: [{ nextCheckAt: { sort: 'asc', nulls: 'first' } }],
    take: limit,
    select: { id: true, platform: true },
  });
  const settings = await prisma.integrationSetting.findMany({
    select: { platform: true, monitoringEnabled: true, isEnabled: true },
  });
  const enabled = new Set(settings.filter((s) => s.isEnabled && s.monitoringEnabled).map((s) => s.platform));
  return rows.filter((r) => enabled.size === 0 || enabled.has(r.platform)).map((r) => r.id);
}

/** Accounts on API-configured platforms that haven't synced in 24h. */
export async function findStaleAccountIds(limit: number): Promise<string[]> {
  const services = createServices(systemContext());
  const apiPlatforms = services.providers.capabilities().filter((c) => c.apiConfigured).map((c) => c.platform);
  if (apiPlatforms.length === 0) return [];
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await prisma.socialAccount.findMany({
    where: { platform: { in: apiPlatforms }, OR: [{ lastSyncedAt: { lte: dayAgo } }, { lastSyncedAt: null }] },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
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

  const overdue = await prisma.deliverable.findMany({
    where: { dueDate: { lt: now }, status: { in: [...OPEN_DELIVERABLE] } },
    include: { campaignInfluencer: { select: { campaignId: true, campaign: { select: { name: true, brandId: true } } } } },
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
    });
    created++;
  }

  const dueSoon = await prisma.deliverable.findMany({
    where: { dueDate: { gte: now, lte: soon }, status: { in: [...OPEN_DELIVERABLE] } },
    include: { campaignInfluencer: { select: { campaignId: true, campaign: { select: { name: true, brandId: true } } } } },
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
    });
    created++;
  }

  const endingCampaigns = await prisma.campaign.findMany({
    where: { status: 'ACTIVE', endDate: { gte: now, lte: ending } },
    select: { id: true, name: true, brandId: true },
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
    });
    created++;
  }

  return { created };
}
