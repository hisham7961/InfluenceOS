import { requests, z } from '@influenceos/contracts';
import type {
  ActivityDTO,
  ApiEndpointDTO,
  ApiModuleDTO,
  AttachmentDTO,
  AuthResultDTO,
  BrandDashboardDTO,
  BrandDetailDTO,
  BrandInfluencerDTO,
  BrandSummaryDTO,
  CalendarEventDTO,
  CampaignDetailDTO,
  CampaignInfluencerDTO,
  CampaignSummaryDTO,
  ClientConfigDTO,
  ContentMetricsDTO,
  CostSummaryDTO,
  CursorPage,
  DeliverableDTO,
  DeviceSessionDTO,
  ExpenseDTO,
  FeatureDTO,
  GlobalDashboardDTO,
  IntegrationCapabilityDTO,
  IntegrationDTO,
  InfluencerDetailDTO,
  InfluencerSummaryDTO,
  MonitoringEventDTO,
  NoteDTO,
  NotificationDTO,
  Paginated,
  PlatformStatusDTO,
  PublishedContentDTO,
  ReportDTO,
  ResolveProfileResultDTO,
  ScriptDTO,
  SearchResultDTO,
  SocialAccountDTO,
  StorageStatusDTO,
  UploadTicketDTO,
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
      sessions: () => http.get<DeviceSessionDTO[]>(`${V}/auth/sessions`),
      revokeSession: (id: string) => http.del<void>(`${V}/auth/sessions/${id}`),
    },

    users: {
      list: () => http.get<UserDTO[]>(`${V}/users`),
      create: (body: In<typeof requests.registerUserSchema>) => http.post<UserDTO>(`${V}/users`, body),
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
    },

    influencers: {
      list: (params?: QueryParams) =>
        http.get<Paginated<InfluencerSummaryDTO>>(`${V}/influencers`, { query: params }),
      get: (id: string) => http.get<InfluencerDetailDTO>(`${V}/influencers/${id}`),
      create: (body: In<typeof requests.influencerCreateSchema>) =>
        http.post<InfluencerDetailDTO>(`${V}/influencers`, body),
      update: (id: string, body: In<typeof requests.influencerUpdateSchema>) =>
        http.patch<InfluencerDetailDTO>(`${V}/influencers/${id}`, body),
      resolve: (body: In<typeof requests.resolveProfileSchema>) =>
        http.post<ResolveProfileResultDTO>(`${V}/influencers/resolve`, body),
      socialAccounts: (id: string) => http.get<SocialAccountDTO[]>(`${V}/influencers/${id}/social-accounts`),
      addSocialAccount: (id: string, body: Omit<In<typeof requests.socialAccountCreateSchema>, 'influencerId'>) =>
        http.post<SocialAccountDTO>(`${V}/influencers/${id}/social-accounts`, { ...body, influencerId: id }),
      notes: (id: string) => http.get<NoteDTO[]>(`${V}/influencers/${id}/notes`),
      brandRelationships: (id: string) => http.get<BrandInfluencerDTO[]>(`${V}/influencers/${id}/brands`),
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
      create: (body: In<typeof requests.noteCreateSchema>) => http.post<NoteDTO>(`${V}/notes`, body),
      update: (id: string, body: { body?: string; pinned?: boolean }) =>
        http.patch<NoteDTO>(`${V}/notes/${id}`, body),
      remove: (id: string) => http.del<void>(`${V}/notes/${id}`),
    },

    campaigns: {
      list: (params?: QueryParams) =>
        http.get<Paginated<CampaignSummaryDTO>>(`${V}/campaigns`, { query: params }),
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
    },

    deliverables: {
      update: (id: string, body: In<typeof requests.deliverableUpdateSchema>) =>
        http.patch<DeliverableDTO>(`${V}/deliverables/${id}`, body),
      remove: (id: string) => http.del<void>(`${V}/deliverables/${id}`),
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
    },

    platform: {
      features: () => http.get<FeatureDTO[]>(`${V}/platform/features`),
      modules: () => http.get<ApiModuleDTO[]>(`${V}/platform/modules`),
      status: () => http.get<PlatformStatusDTO>(`${V}/platform/status`),
      storage: () => http.get<StorageStatusDTO>(`${V}/platform/storage`),
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
