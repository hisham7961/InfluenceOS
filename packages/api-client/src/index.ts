import { requests, z } from '@influenceos/contracts';
import type {
  ActivityDTO,
  ApiEndpointDTO,
  ApiModuleDTO,
  AttachmentDTO,
  AuditEntryDTO,
  AuthResultDTO,
  BrandDashboardDTO,
  BrandDetailDTO,
  BrandInfluencerDTO,
  BrandSummaryDTO,
  BulkResultDTO,
  CalendarEventDTO,
  CampaignCandidateDTO,
  CampaignDetailDTO,
  CampaignEfficiencyDTO,
  CampaignInfluencerDTO,
  CampaignOperationsBoardDTO,
  CampaignSummaryDTO,
  ClientConfigDTO,
  ContentMetricsDTO,
  ContentSummaryDTO,
  ContentViewerStateDTO,
  CostSummaryDTO,
  CreatorLeaderboardDTO,
  CreatorReliabilityDTO,
  CreatorSnapshotDTO,
  CreatorTimelineItemDTO,
  CursorPage,
  DeliverableDTO,
  DeliverableSubmissionDTO,
  DeviceSessionDTO,
  ExecDashboardDTO,
  ExpenseDTO,
  FeatureDTO,
  GlobalDashboardDTO,
  CreatorConnectionDTO,
  CreatorOAuthStartDTO,
  IntegrationCapabilityDTO,
  IntegrationDTO,
  ProviderCredentialStatusDTO,
  InfluencerDetailDTO,
  InfluencerSummaryDTO,
  InspirationItemDTO,
  LogisticsRequestDTO,
  MonitoringEventDTO,
  NoteDTO,
  NotificationDTO,
  Paginated,
  PlatformStatusDTO,
  ProductShipmentDTO,
  PublishedContentDTO,
  ReportDTO,
  ResolveProfileResultDTO,
  SavedViewDTO,
  ScriptDTO,
  SearchResultDTO,
  SocialAccountDTO,
  StorageStatusDTO,
  TeamMemberRefDTO,
  UploadTicketDTO,
  UsageRightDTO,
  UserDTO,
} from '@influenceos/contracts';
import { HttpCore, type ClientConfig } from './core';

export { ApiError } from './core';
export type { ClientConfig, TokenProvider } from './core';

type QueryParams = Record<string, string | number | boolean | undefined | null>;
type In<S extends z.ZodTypeAny> = z.input<S>;

/**
 * Strongly-typed InfluenceOS API client (addendum §9). The Web app consumes
 * this exclusively; a future React Native app consumes the same client. Request
 * bodies are validated against the shared contract schemas; responses are the
 * shared DTOs.
 */
export function createClient(config: ClientConfig) {
  const http = new HttpCore(config);
  const V = '/api/v1';

  return {
    http,

    auth: {
      login: (body: In<typeof requests.loginSchema>) =>
        http.post<AuthResultDTO>(`${V}/auth/login`, body),
      refresh: (body?: In<typeof requests.refreshSchema>) =>
        http.post<AuthResultDTO>(`${V}/auth/refresh`, body ?? {}),
      logout: (body?: { refreshToken?: string }) => http.post<void>(`${V}/auth/logout`, body ?? {}),
      me: () => http.get<UserDTO>(`${V}/auth/me`),
      updatePreferences: (body: In<typeof requests.updatePreferencesSchema>) =>
        http.patch<UserDTO>(`${V}/auth/me/preferences`, body),
      sessions: () => http.get<DeviceSessionDTO[]>(`${V}/auth/sessions`),
      revokeSession: (id: string) => http.del<void>(`${V}/auth/sessions/${id}`),
      changePassword: (body: In<typeof requests.changePasswordSchema>) =>
        http.post<void>(`${V}/auth/change-password`, body),
    },

    users: {
      list: () => http.get<UserDTO[]>(`${V}/users`),
      create: (body: In<typeof requests.registerUserSchema>) => http.post<UserDTO>(`${V}/users`, body),
      // Lightweight id/name/avatar-only directory for the @mention picker — any authenticated user may read it.
      directory: () => http.get<TeamMemberRefDTO[]>(`${V}/users/directory`),
    },

    brands: {
      list: (params?: { includeInactive?: boolean }) =>
        http.get<BrandSummaryDTO[]>(`${V}/brands`, { query: params as QueryParams }),
      get: (idOrSlug: string) => http.get<BrandDetailDTO>(`${V}/brands/${idOrSlug}`),
      create: (body: In<typeof requests.brandCreateSchema>) =>
        http.post<BrandDetailDTO>(`${V}/brands`, body),
      update: (id: string, body: In<typeof requests.brandUpdateSchema>) =>
        http.patch<BrandDetailDTO>(`${V}/brands/${id}`, body),
      dashboard: (idOrSlug: string) => http.get<BrandDashboardDTO>(`${V}/brands/${idOrSlug}/dashboard`),
      // Usage-rights ledger for a brand (W3-2 web surface).
      usageRights: (brandId: string) => http.get<UsageRightDTO[]>(`${V}/brands/${brandId}/usage-rights`),
      createUsageRight: (brandId: string, body: In<typeof requests.usageRightCreateSchema>) =>
        http.post<UsageRightDTO>(`${V}/brands/${brandId}/usage-rights`, body),
      revokeUsageRight: (usageRightId: string) =>
        http.post<UsageRightDTO>(`${V}/usage-rights/${usageRightId}/revoke`, {}),
    },

    influencers: {
      list: (params?: QueryParams) =>
        http.get<Paginated<InfluencerSummaryDTO>>(`${V}/influencers`, { query: params }),
      // Stable cursor pagination for the directory (W7-2 / mobile-ready feeds).
      listCursor: (params?: QueryParams) =>
        http.get<CursorPage<InfluencerSummaryDTO>>(`${V}/influencers/cursor`, { query: params }),
      // Export influencers + their info. Raw form returns the file Response
      // (CSV by default, `format=json` for structured rows) — for programmatic
      // / mobile use. `exportUrl` builds a same-origin href for a browser
      // download link (auth flows via the cookie transport, like reports.csvUrl).
      exportRows: (params?: QueryParams) =>
        http.get<Response>(`${V}/influencers/export`, { query: params, raw: true }),
      exportUrl: (params?: QueryParams) => {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(params ?? {})) if (v != null && v !== '') q.set(k, String(v));
        q.set('format', 'csv');
        return `${config.baseUrl.replace(/\/$/, '')}${V}/influencers/export?${q.toString()}`;
      },
      get: (id: string) => http.get<InfluencerDetailDTO>(`${V}/influencers/${id}`),
      create: (body: In<typeof requests.influencerCreateSchema>) =>
        http.post<InfluencerDetailDTO>(`${V}/influencers`, body),
      update: (id: string, body: In<typeof requests.influencerUpdateSchema>) =>
        http.patch<InfluencerDetailDTO>(`${V}/influencers/${id}`, body),
      resolve: (body: In<typeof requests.resolveProfileSchema>) =>
        http.post<ResolveProfileResultDTO>(`${V}/influencers/resolve`, body),
      socialAccounts: (id: string) => http.get<SocialAccountDTO[]>(`${V}/influencers/${id}/social-accounts`),
      // Creator-OAuth connections (INT-3; inert until platform app review).
      creatorConnections: (id: string) =>
        http.get<CreatorConnectionDTO[]>(`${V}/influencers/${id}/creator-connections`),
      startCreatorConnection: (id: string, platform: string) =>
        http.post<CreatorOAuthStartDTO>(`${V}/influencers/${id}/creator-connections/${platform}/start`),
      disconnectCreator: (id: string, platform: string) =>
        http.del<{ ok: true }>(`${V}/influencers/${id}/creator-connections/${platform}`),
      addSocialAccount: (id: string, body: Omit<In<typeof requests.socialAccountCreateSchema>, 'influencerId'>) =>
        http.post<SocialAccountDTO>(`${V}/influencers/${id}/social-accounts`, { ...body, influencerId: id }),
      notes: (id: string) => http.get<NoteDTO[]>(`${V}/influencers/${id}/notes`),
      brandRelationships: (id: string) => http.get<BrandInfluencerDTO[]>(`${V}/influencers/${id}/brands`),
      // Creator 360 (Operations Intelligence pass).
      snapshot: (id: string) => http.get<CreatorSnapshotDTO>(`${V}/influencers/${id}/snapshot`),
      reliability: (id: string) => http.get<CreatorReliabilityDTO>(`${V}/influencers/${id}/reliability`),
      timeline: (id: string, params?: QueryParams) =>
        http.get<CursorPage<CreatorTimelineItemDTO>>(`${V}/influencers/${id}/timeline`, { query: params }),
    },

    socialAccounts: {
      update: (id: string, body: In<typeof requests.socialAccountUpdateSchema>) =>
        http.patch<SocialAccountDTO>(`${V}/social-accounts/${id}`, body),
      sync: (id: string) =>
        http.post<{ account: SocialAccountDTO; synced: boolean; message: string }>(
          `${V}/social-accounts/${id}/sync`,
        ),
      remove: (id: string) => http.del<void>(`${V}/social-accounts/${id}`),
    },

    brandInfluencers: {
      upsert: (body: In<typeof requests.brandInfluencerSchema>) =>
        http.post<BrandInfluencerDTO>(`${V}/brand-influencers`, body),
      remove: (id: string) => http.del<void>(`${V}/brand-influencers/${id}`),
    },

    notes: {
      // Generic context thread — the ONE read path for Content/Deliverable/Shipment/
      // Inspiration comments and Campaign/General chat (Operations Intelligence pass).
      list: (context: QueryParams, params?: QueryParams) =>
        http.get<CursorPage<NoteDTO>>(`${V}/notes`, { query: { ...context, ...params } }),
      create: (body: In<typeof requests.noteCreateSchema>) => http.post<NoteDTO>(`${V}/notes`, body),
      update: (id: string, body: { body?: string; pinned?: boolean }) =>
        http.patch<NoteDTO>(`${V}/notes/${id}`, body),
      editBody: (id: string, body: In<typeof requests.noteEditSchema>) =>
        http.patch<NoteDTO>(`${V}/notes/${id}/body`, body),
      pin: (id: string, pinned: boolean) => http.patch<NoteDTO>(`${V}/notes/${id}/pin`, { pinned }),
      remove: (id: string) => http.del<void>(`${V}/notes/${id}`),
      // Internal notes on a piece of content (Content Command Center pass) —
      // reuses this same Note model, not a parallel comment system.
      forContent: (publishedContentId: string) => http.get<NoteDTO[]>(`${V}/content/${publishedContentId}/notes`),
      forBrand: (brandId: string) => http.get<NoteDTO[]>(`${V}/brands/${brandId}/notes`),
      mentions: (params?: QueryParams) => http.get<CursorPage<NoteDTO>>(`${V}/notes/mentions`, { query: params }),
      markConversationRead: (conversationKey: string) =>
        http.post<{ lastReadAt: string }>(`${V}/notes/conversations/read`, { conversationKey }),
    },

    campaigns: {
      list: (params?: QueryParams) =>
        http.get<Paginated<CampaignSummaryDTO>>(`${V}/campaigns`, { query: params }),
      // Stable cursor pagination for the directory (W7-2 / mobile-ready feeds).
      listCursor: (params?: QueryParams) =>
        http.get<CursorPage<CampaignSummaryDTO>>(`${V}/campaigns/cursor`, { query: params }),
      // Sourcing pipeline — candidates for a campaign (W3-3 web surface).
      candidates: (id: string, params?: QueryParams) =>
        http.get<CampaignCandidateDTO[]>(`${V}/campaigns/${id}/candidates`, { query: params }),
      // Bulk-import a CSV of creators as sourcing candidates (W3-4 web surface).
      importCandidates: (id: string, body: In<typeof requests.candidateCsvImportSchema>) =>
        http.post<BulkResultDTO>(`${V}/campaigns/${id}/candidates/import`, body),
      // Product shipments across a campaign roster (W3-5 web surface).
      shipments: (id: string) => http.get<ProductShipmentDTO[]>(`${V}/campaigns/${id}/shipments`),
      // Submission review queue across a campaign (W3-1 web surface).
      submissions: (id: string) => http.get<DeliverableSubmissionDTO[]>(`${V}/campaigns/${id}/submissions`),
      // Campaign Operations Board — per-influencer stage pipeline (Operations Intelligence).
      operationsBoard: (id: string) => http.get<CampaignOperationsBoardDTO>(`${V}/campaigns/${id}/operations-board`),
      get: (idOrSlug: string) => http.get<CampaignDetailDTO>(`${V}/campaigns/${idOrSlug}`),
      create: (body: In<typeof requests.campaignCreateSchema>) =>
        http.post<CampaignDetailDTO>(`${V}/campaigns`, body),
      update: (id: string, body: In<typeof requests.campaignUpdateSchema>) =>
        http.patch<CampaignDetailDTO>(`${V}/campaigns/${id}`, body),
      influencers: (id: string) => http.get<CampaignInfluencerDTO[]>(`${V}/campaigns/${id}/influencers`),
      addInfluencer: (id: string, body: Omit<In<typeof requests.campaignInfluencerCreateSchema>, 'campaignId'>) =>
        http.post<CampaignInfluencerDTO>(`${V}/campaigns/${id}/influencers`, { ...body, campaignId: id }),
      scripts: (id: string) => http.get<ScriptDTO[]>(`${V}/campaigns/${id}/scripts`),
      costs: (id: string) => http.get<{ expenses: ExpenseDTO[]; summary: CostSummaryDTO }>(`${V}/campaigns/${id}/costs`),
      // Server-computed spend efficiency (CPV/CPM/CPE) + metric freshness (W6-1).
      efficiency: (idOrSlug: string) => http.get<CampaignEfficiencyDTO>(`${V}/campaigns/${idOrSlug}/efficiency`),
      addExpense: (id: string, body: Omit<In<typeof requests.expenseCreateSchema>, 'campaignId'>) =>
        http.post<ExpenseDTO>(`${V}/campaigns/${id}/expenses`, { ...body, campaignId: id }),
    },

    campaignInfluencers: {
      get: (id: string) => http.get<CampaignInfluencerDTO>(`${V}/campaign-influencers/${id}`),
      update: (id: string, body: In<typeof requests.campaignInfluencerUpdateSchema>) =>
        http.patch<CampaignInfluencerDTO>(`${V}/campaign-influencers/${id}`, body),
      remove: (id: string) => http.del<void>(`${V}/campaign-influencers/${id}`),
      addDeliverable: (id: string, body: Omit<In<typeof requests.deliverableCreateSchema>, 'campaignInfluencerId'>) =>
        http.post<DeliverableDTO>(`${V}/campaign-influencers/${id}/deliverables`, {
          ...body,
          campaignInfluencerId: id,
        }),
      // Logistics: shipments on this campaign participation (evolved W3-5 — one
      // campaign-influencer may have several, never just 0-or-1).
      shipments: (id: string) => http.get<ProductShipmentDTO[]>(`${V}/campaign-influencers/${id}/shipments`),
      createShipment: (id: string, body: In<typeof requests.shipmentCreateSchema>) =>
        http.post<ProductShipmentDTO>(`${V}/campaign-influencers/${id}/shipments`, body),
    },

    deliverables: {
      update: (id: string, body: In<typeof requests.deliverableUpdateSchema>) =>
        http.patch<DeliverableDTO>(`${V}/deliverables/${id}`, body),
      remove: (id: string) => http.del<void>(`${V}/deliverables/${id}`),
      // Draft/asset review queue for one deliverable (W3-1) — never a public URL requirement.
      submissions: (id: string) => http.get<DeliverableSubmissionDTO[]>(`${V}/deliverables/${id}/submissions`),
      submit: (id: string, body: In<typeof requests.submissionCreateSchema>) =>
        http.post<DeliverableSubmissionDTO>(`${V}/deliverables/${id}/submissions`, body),
    },

    submissions: {
      get: (id: string) => http.get<DeliverableSubmissionDTO>(`${V}/submissions/${id}`),
      review: (id: string, body: In<typeof requests.submissionReviewSchema>) =>
        http.post<DeliverableSubmissionDTO>(`${V}/submissions/${id}/review`, body),
      addComment: (id: string, body: In<typeof requests.submissionCommentSchema>) =>
        http.post<DeliverableSubmissionDTO>(`${V}/submissions/${id}/comments`, body),
    },

    // Logistics — shipment-id-keyed ops, plus the cross-campaign /logistics
    // workspace (reads the same shipment rows every other view reads).
    shipments: {
      list: (params?: QueryParams) =>
        http.get<{ data: LogisticsRequestDTO[]; hasMore: boolean; nextCursor: string | null }>(`${V}/shipments`, {
          query: params,
        }),
      get: (id: string) => http.get<ProductShipmentDTO>(`${V}/shipments/${id}`),
      update: (id: string, body: In<typeof requests.shipmentUpdateSchema>) =>
        http.patch<ProductShipmentDTO>(`${V}/shipments/${id}`, body),
      updateStatus: (id: string, body: In<typeof requests.shipmentStatusSchema>) =>
        http.post<ProductShipmentDTO>(`${V}/shipments/${id}/status`, body),
    },

    inspiration: {
      list: (params?: QueryParams) => http.get<CursorPage<InspirationItemDTO>>(`${V}/inspiration`, { query: params }),
      get: (id: string) => http.get<InspirationItemDTO>(`${V}/inspiration/${id}`),
      create: (body: In<typeof requests.inspirationCreateSchema>) =>
        http.post<InspirationItemDTO>(`${V}/inspiration`, body),
      update: (id: string, body: In<typeof requests.inspirationUpdateSchema>) =>
        http.patch<InspirationItemDTO>(`${V}/inspiration/${id}`, body),
      remove: (id: string) => http.del<void>(`${V}/inspiration/${id}`),
    },

    scripts: {
      get: (id: string) => http.get<ScriptDTO>(`${V}/scripts/${id}`),
      create: (body: In<typeof requests.scriptCreateSchema>) => http.post<ScriptDTO>(`${V}/scripts`, body),
      addVersion: (id: string, body: In<typeof requests.scriptVersionSchema>) =>
        http.post<ScriptDTO>(`${V}/scripts/${id}/versions`, body),
    },

    content: {
      feed: (params?: QueryParams) =>
        http.get<CursorPage<PublishedContentDTO>>(`${V}/content/feed`, { query: params }),
      get: (id: string) => http.get<PublishedContentDTO>(`${V}/content/${id}`),
      create: (body: In<typeof requests.publishedContentCreateSchema>) =>
        http.post<PublishedContentDTO>(`${V}/content`, body),
      update: (id: string, body: In<typeof requests.publishedContentUpdateSchema>) =>
        http.patch<PublishedContentDTO>(`${V}/content/${id}`, body),
      metrics: (id: string) => http.get<ContentMetricsDTO[]>(`${V}/content/${id}/metrics`),
      monitoring: (id: string) => http.get<MonitoringEventDTO[]>(`${V}/content/${id}/monitoring`),
      addMetrics: (id: string, body: In<typeof requests.contentMetricSchema>) =>
        http.post<PublishedContentDTO>(`${V}/content/${id}/metrics`, body),
      refresh: (id: string) => http.post<PublishedContentDTO>(`${V}/content/${id}/refresh`),
      // Content Command Center — per-user counts + brand aggregation, and the
      // seen/reviewed/review-later mutation the Viewer and card actions send.
      summary: (params?: { todayStart?: string; todayEnd?: string }) =>
        http.get<ContentSummaryDTO>(`${V}/content/summary`, { query: params }),
      updateViewState: (id: string, body: In<typeof requests.contentViewStateSchema>) =>
        http.patch<ContentViewerStateDTO>(`${V}/content/${id}/view-state`, body),
    },

    expenses: {
      update: (id: string, body: In<typeof requests.expenseUpdateSchema>) =>
        http.patch<ExpenseDTO>(`${V}/expenses/${id}`, body),
      remove: (id: string) => http.del<void>(`${V}/expenses/${id}`),
    },

    dashboard: {
      global: (brandId?: string) =>
        http.get<GlobalDashboardDTO>(`${V}/dashboard/global`, { query: { brandId } }),
      attention: (brandId?: string) =>
        http.get<GlobalDashboardDTO['attention']>(`${V}/dashboard/attention`, { query: { brandId } }),
      whatsNew: (brandId?: string) =>
        http.get<GlobalDashboardDTO['whatsNew']>(`${V}/whats-new`, { query: { brandId } }),
      // Advances the caller's own "since your last visit" checkpoint — call
      // this when the person opens/dismisses the What's New panel, never on
      // a passive GET (item 57).
      whatsNewAck: () => http.post<{ lastWhatsNewViewedAt: string }>(`${V}/dashboard/whats-new/ack`),
    },

    calendar: {
      events: (params: QueryParams) => http.get<CalendarEventDTO[]>(`${V}/calendar`, { query: params }),
    },

    reports: {
      generate: (params: QueryParams) => http.get<ReportDTO>(`${V}/reports`, { query: params }),
      csvUrl: (params: QueryParams) => {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v));
        q.set('format', 'csv');
        return `${config.baseUrl.replace(/\/$/, '')}${V}/reports?${q.toString()}`;
      },
      // Creator performance leaderboard (W6-2).
      leaderboard: (params?: QueryParams) =>
        http.get<CreatorLeaderboardDTO>(`${V}/reports/leaderboard`, { query: params }),
      // Executive overview: spend-vs-budget, today, since-yesterday, cross-brand (W6-3).
      execDashboard: (brandId?: string) =>
        http.get<ExecDashboardDTO>(`${V}/reports/exec-dashboard`, { query: { brandId } }),
    },

    notifications: {
      list: (params?: QueryParams) =>
        http.get<CursorPage<NotificationDTO>>(`${V}/notifications`, { query: params }),
      unreadCount: () => http.get<{ count: number }>(`${V}/notifications/unread-count`),
      markRead: (body: In<typeof requests.markReadSchema>) =>
        http.post<{ updated: number }>(`${V}/notifications/read`, body),
    },

    activity: {
      feed: (params?: QueryParams) => http.get<CursorPage<ActivityDTO>>(`${V}/activity`, { query: params }),
    },

    search: {
      query: (params: QueryParams) => http.get<SearchResultDTO[]>(`${V}/search`, { query: params }),
    },

    // Saved directory views / segments (W3-6 web surface).
    savedViews: {
      list: (scope?: string) => http.get<SavedViewDTO[]>(`${V}/saved-views`, { query: { scope } }),
      create: (body: In<typeof requests.savedViewCreateSchema>) =>
        http.post<SavedViewDTO>(`${V}/saved-views`, body),
      remove: (id: string) => http.del<void>(`${V}/saved-views/${id}`),
    },

    files: {
      /** Phase 1 — reserve a key and get a signed upload ticket. */
      initiate: (body: In<typeof requests.attachmentInitiateSchema>) =>
        http.post<UploadTicketDTO>(`${V}/files`, body),
      /** Phase 2 — confirm the object landed and create the record. */
      complete: (uploadToken: string) =>
        http.post<AttachmentDTO>(`${V}/files/complete`, { uploadToken }),
      list: (params: In<typeof requests.attachmentTargetSchema>) =>
        http.get<AttachmentDTO[]>(`${V}/files`, { query: params as QueryParams }),
      get: (id: string) => http.get<AttachmentDTO>(`${V}/files/${id}`),
      remove: (id: string) => http.del<void>(`${V}/files/${id}`),
    },

    integrations: {
      list: () => http.get<IntegrationDTO[]>(`${V}/integrations`),
      capabilities: () => http.get<IntegrationCapabilityDTO[]>(`${V}/integrations/capabilities`),
      update: (platform: string, body: In<typeof requests.integrationUpdateSchema>) =>
        http.patch<IntegrationDTO>(`${V}/integrations/${platform}`, body),
      test: (platform: string) => http.post<{ ok: boolean; message: string }>(`${V}/integrations/${platform}/test`),
      // Encrypted provider-credential store (INT-4, admin).
      credentials: () => http.get<ProviderCredentialStatusDTO[]>(`${V}/integrations/credentials`),
      setCredential: (body: In<typeof requests.providerCredentialSetSchema>) =>
        http.post<ProviderCredentialStatusDTO[]>(`${V}/integrations/credentials`, body),
      removeCredential: (key: string) =>
        http.del<ProviderCredentialStatusDTO[]>(`${V}/integrations/credentials/${key}`),
    },

    platform: {
      features: () => http.get<FeatureDTO[]>(`${V}/platform/features`),
      modules: () => http.get<ApiModuleDTO[]>(`${V}/platform/modules`),
      status: () => http.get<PlatformStatusDTO>(`${V}/platform/status`),
      storage: () => http.get<StorageStatusDTO>(`${V}/platform/storage`),
      audit: (params?: QueryParams) => http.get<CursorPage<AuditEntryDTO>>(`${V}/platform/audit`, { query: params }),
      endpoints: () => http.get<ApiEndpointDTO[]>(`${V}/platform/endpoints`),
      flags: () => http.get<{ key: string; description: string | null; scope: string; enabled: boolean }[]>(`${V}/platform/flags`),
      setFlag: (key: string, enabled: boolean) =>
        http.patch<unknown>(`${V}/platform/flags/${key}`, { enabled }),
      appVersions: () => http.get<unknown>(`${V}/platform/app-versions`),
      updateClientConfig: (body: In<typeof requests.clientConfigUpdateSchema>) =>
        http.patch<ClientConfigDTO>(`${V}/platform/client-config`, body),
    },

    clientConfig: {
      get: () => http.get<ClientConfigDTO>(`${V}/client-config`),
    },
  };
}

export type InfluenceOSClient = ReturnType<typeof createClient>;
