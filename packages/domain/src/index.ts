// @influenceos/domain — the application/business layer. ALL business rules live
// here (server-side) and services return explicit DTOs, never raw Prisma
// models. The API and the worker construct a per-request context and call these
// services; the Web/Mobile clients never touch the database directly.

import type { DomainContext } from './context';
import { makeActivityService } from './services/activity.service';
import { makeAttachmentService } from './services/attachment.service';
import { makeAuthService } from './services/auth.service';
import { makeBrandService } from './services/brand.service';
import { makeBrandInfluencerService } from './services/brand-influencer.service';
import { makeCalendarService } from './services/calendar.service';
import { makeCampaignService } from './services/campaign.service';
import { makeCampaignInfluencerService } from './services/campaign-influencer.service';
import { makeContentService } from './services/content.service';
import { makeDashboardService } from './services/dashboard.service';
import { makeDeliverableService } from './services/deliverable.service';
import { makeExpenseService } from './services/expense.service';
import { makeInfluencerService } from './services/influencer.service';
import { makeIntegrationService } from './services/integration.service';
import { makeNoteService } from './services/note.service';
import { makeNotificationService } from './services/notification.service';
import { makePlatformService } from './services/platform.service';
import { makeProviderService } from './services/provider.service';
import { makeReportService } from './services/report.service';
import { makeScriptService } from './services/script.service';
import { makeSearchService } from './services/search.service';
import { makeSocialAccountService } from './services/social-account.service';

export function createServices(ctx: DomainContext) {
  return {
    ctx,
    auth: makeAuthService(ctx),
    brands: makeBrandService(ctx),
    brandInfluencers: makeBrandInfluencerService(ctx),
    influencers: makeInfluencerService(ctx),
    socialAccounts: makeSocialAccountService(ctx),
    providers: makeProviderService(ctx),
    campaigns: makeCampaignService(ctx),
    campaignInfluencers: makeCampaignInfluencerService(ctx),
    deliverables: makeDeliverableService(ctx),
    scripts: makeScriptService(ctx),
    content: makeContentService(ctx),
    expenses: makeExpenseService(ctx),
    notes: makeNoteService(ctx),
    activity: makeActivityService(ctx),
    attachments: makeAttachmentService(ctx),
    notifications: makeNotificationService(ctx),
    search: makeSearchService(ctx),
    calendar: makeCalendarService(ctx),
    reports: makeReportService(ctx),
    integrations: makeIntegrationService(ctx),
    platform: makePlatformService(ctx),
    dashboard: makeDashboardService(ctx),
  };
}

export type Services = ReturnType<typeof createServices>;

export * from './context';
export { AppError } from './errors';
export { logActivity, createNotification } from './lib/helpers';
export { maxUploadBytes } from './services/attachment.service';
export { getStorage, resetStorage, sanitizeFileName, buildStorageKey } from './lib/storage';

export {
  makeAuthService,
  makeBrandService,
  makeInfluencerService,
  makeContentService,
  makeDashboardService,
  makeProviderService,
};
