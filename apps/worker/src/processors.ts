import { prisma, type Platform } from '@influenceos/database';
import {
  claimDueContent,
  claimStaleAccounts,
  countDueContent,
  countStaleAccounts,
  createServices,
  runReminders,
  systemContext,
  type UploadCleanupResult,
} from '@influenceos/domain';

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

/**
 * Deadline, campaign-ending and usage-rights reminders. The rules live in the
 * domain (runReminders) so they're tested with the rest of the business
 * logic; the worker only runs them on its schedule.
 */
export async function generateNotifications(): Promise<{ created: number }> {
  return runReminders(systemContext(), new Date());
}
