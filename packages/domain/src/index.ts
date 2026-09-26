// @influenceos/domain — the application/business layer. ALL business rules live
// here (server-side) and services return explicit DTOs, never raw Prisma
// models. The API and the worker construct a per-request context and call these
// services; the Web/Mobile clients never touch the database directly.

import type { DomainContext } from './context';
import { makeActivityService } from './services/activity.service';
import { makeAnalyticsService } from './services/analytics.service';
import { makeCampaignReportService } from './services/campaign-report.service';
import { makePaymentService } from './services/payment.service';
import { makeAttachmentService } from './services/attachment.service';
import { makeAuthService } from './services/auth.service';
import { makeBrandService } from './services/brand.service';
import { makeBrandInfluencerService } from './services/brand-influencer.service';
import { makeBulkService } from './services/bulk.service';
import { makeBulkInfluencerService } from './services/bulk-influencer.service';
import { makeCalendarService } from './services/calendar.service';
import { makeCampaignService } from './services/campaign.service';
import { makeCampaignInfluencerService } from './services/campaign-influencer.service';
import { makeCampaignOperationsService } from './services/campaign-operations.service';
import { makeContentService } from './services/content.service';
import { makeCredentialService } from './services/credential.service';
import { makeCreatorOAuthService } from './services/creator-oauth.service';
import { makeCreator360Service } from './services/creator360.service';
import { makeDashboardService } from './services/dashboard.service';
import { makeDataQualityService } from './services/data-quality.service';
import { makeDeliverableService } from './services/deliverable.service';
import { makeExpenseService } from './services/expense.service';
import { makeInfluencerService } from './services/influencer.service';
import { makeInspirationService } from './services/inspiration.service';
import { makeIntegrationService } from './services/integration.service';
import { makeIntegrityGuardService } from './services/integrity-guard.service';
import { makeLogisticsIssueService } from './services/logistics-issue.service';
import { makeNoteService } from './services/note.service';
import { makeNotificationService } from './services/notification.service';
import { makePlatformService } from './services/platform.service';
import { makeProviderService } from './services/provider.service';
import { makeReportService } from './services/report.service';
import { makeSavedViewService } from './services/saved-view.service';
import { makeScriptService } from './services/script.service';
import { makeSearchService } from './services/search.service';
import { makeShipmentService } from './services/shipment.service';
import { makeSocialAccountService } from './services/social-account.service';
import { makeSourcingService } from './services/sourcing.service';
import { makeSubmissionService } from './services/submission.service';
import { makeUsageRightService } from './services/usage-right.service';
import { makeSalesService } from './services/sales.service';
import { makeReportShareService } from './services/report-share.service';
import { makeCreatorLinkService } from './services/creator-link.service';
import { makeDiscoveryService } from './services/discovery.service';
import { makeLicenceService } from './services/licence.service';
import { makeWorkService } from './services/work.service';
import { makeAudienceService } from './services/audience.service';
import { makeBenchmarkService } from './services/benchmark.service';
import { makeAiService } from './services/ai.service';
import { makeAiWritingService } from './services/ai-writing.service';

export function createServices(ctx: DomainContext) {
  return {
    ctx,
    auth: makeAuthService(ctx),
    brands: makeBrandService(ctx),
    brandInfluencers: makeBrandInfluencerService(ctx),
    influencers: makeInfluencerService(ctx),
    creator360: makeCreator360Service(ctx),
    dataQuality: makeDataQualityService(ctx),
    integrityGuard: makeIntegrityGuardService(ctx),
    inspiration: makeInspirationService(ctx),
    socialAccounts: makeSocialAccountService(ctx),
    providers: makeProviderService(ctx),
    campaigns: makeCampaignService(ctx),
    campaignInfluencers: makeCampaignInfluencerService(ctx),
    campaignOperations: makeCampaignOperationsService(ctx),
    sourcing: makeSourcingService(ctx),
    bulk: makeBulkService(ctx),
    bulkInfluencers: makeBulkInfluencerService(ctx),
    shipments: makeShipmentService(ctx),
    logisticsIssues: makeLogisticsIssueService(ctx),
    deliverables: makeDeliverableService(ctx),
    submissions: makeSubmissionService(ctx),
    usageRights: makeUsageRightService(ctx),
    sales: makeSalesService(ctx),
    reportShares: makeReportShareService(ctx),
    creatorLinks: makeCreatorLinkService(ctx),
    discovery: makeDiscoveryService(ctx),
    licences: makeLicenceService(ctx),
    work: makeWorkService(ctx),
    audience: makeAudienceService(ctx),
    benchmarks: makeBenchmarkService(ctx),
    ai: makeAiService(ctx),
    aiWriting: makeAiWritingService(ctx),
    scripts: makeScriptService(ctx),
    content: makeContentService(ctx),
    expenses: makeExpenseService(ctx),
    notes: makeNoteService(ctx),
    activity: makeActivityService(ctx),
    attachments: makeAttachmentService(ctx),
    notifications: makeNotificationService(ctx),
    search: makeSearchService(ctx),
    savedViews: makeSavedViewService(ctx),
    calendar: makeCalendarService(ctx),
    reports: makeReportService(ctx),
    analytics: makeAnalyticsService(ctx),
    campaignReports: makeCampaignReportService(ctx),
    payments: makePaymentService(ctx),
    integrations: makeIntegrationService(ctx),
    credentials: makeCredentialService(ctx),
    creatorOAuth: makeCreatorOAuthService(ctx),
    platform: makePlatformService(ctx),
    dashboard: makeDashboardService(ctx),
  };
}

export type Services = ReturnType<typeof createServices>;

export * from './context';
export { AppError } from './errors';
export { logActivity, createNotification } from './lib/helpers';
export {
  PROVIDER_CREDENTIAL_KEYS,
  CREDENTIAL_KEY_PLATFORM,
  providerCredentialOverrides,
  refreshProviderCredentialOverrides,
  __resetProviderCredentialOverrides,
  isProviderCredentialKey,
  type ProviderCredentialKey,
} from './lib/credential-store';
export { maxUploadBytes, type UploadCleanupResult } from './services/attachment.service';
export { getStorage, resetStorage, sanitizeFileName, buildStorageKey } from './lib/storage';
export { signDownloadTicket, verifyDownloadTicket } from './lib/tokens';
export { diskUsage, type DiskUsage } from './lib/disk';
export { resealStoredSecrets, type ResealResult } from './lib/reseal';
export { setAiClientFactory, resetAiClientFactory, type AiClient } from './lib/ai';
export {
  alertAdmins,
  recordSyncHealth,
  SYNC_FAILURE_THRESHOLD,
  type AdminAlert,
  type PlatformSyncHealth,
} from './lib/ops-alerts';
export {
  deliveredWhere,
  outstandingWhere,
  countedWhere,
  overdueWhere,
  dueWithinWhere,
} from './lib/deliverable-rules';
export { runReminders, OVERDUE_REPEAT_DAYS } from './lib/reminders';
export { type DiscoveryService, DISCOVERY_INTERVAL_MS } from './services/discovery.service';
export { checkGapMs, retryGapMs } from './lib/check-cadence';
export { LICENCE_SOON_DAYS, licenceState, countriesToCheck } from './lib/licences';
export { pruneHistory, RETENTION, type PruneResult } from './lib/retention';
export { buildDigest, removedSinceWhere, REMOVED_CONTENT_STATUSES } from './lib/digest';
export {
  emailConfigFromEnv,
  appUrlFromEnv,
  smtpMailer,
  type EmailConfig,
  type Mailer,
} from './lib/email/config';
export {
  parseSmtpUrl,
  sendSmtp,
  buildMime,
  type MailMessage,
  type SmtpConfig,
} from './lib/email/smtp';
export {
  dispatchNotificationEmails,
  sendDueDigests,
  digestPeriodStart,
  DIGEST_HOUR_KUWAIT,
  __resetDigestRetries,
  type EmailRunOptions,
} from './lib/email/dispatch';
export { renderDigestEmail, renderNotificationEmail, renderTestEmail } from './lib/email/templates';
export { serverText as emailServerText, resetEmailCatalogs } from './lib/email/i18n';
export { __setTestEmailTransport } from './services/notification.service';
export {
  CONTENT_CLAIM_LEASE_MS,
  ACCOUNT_STALE_AFTER_MS,
  ACCOUNT_RETRY_AFTER_MS,
  claimDueContent,
  claimStaleAccounts,
  countDueContent,
  countStaleAccounts,
} from './lib/monitoring-schedule';

export {
  makeAuthService,
  makeBrandService,
  makeInfluencerService,
  makeContentService,
  makeDashboardService,
  makeProviderService,
};
