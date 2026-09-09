import type { EmbedDescriptor } from '@influenceos/shared';
import type {
  AudienceHealthLabel,
  CampaignObjective,
  CampaignStatus,
  ContactMethod,
  ContentStatus,
  DataSource,
  DealType,
  DeliverableStatus,
  DeliverableType,
  ExpenseType,
  IntegrationStatus,
  NotificationCategory,
  ParticipationStatus,
  PaymentStatus,
  Platform,
  Priority,
  RelationshipStatus,
  UserRole,
} from '../enums';

/**
 * Response DTOs (addendum §7). These are deliberately different from the Prisma
 * models so the database can evolve without breaking installed mobile clients.
 * All dates are ISO strings; all money values are numbers.
 */

export type { EmbedDescriptor };

/** Provenance shown in tooltips (spec §53). */
export interface ProvenanceDTO {
  source: DataSource;
  updatedAt: string | null;
  updatedByName?: string | null;
}

// --- Auth / user -----------------------------------------------------------
export interface UserDTO {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl: string | null;
  locale: string;
  theme: string;
}

export interface AuthTokensDTO {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  tokenType: 'Bearer';
}

export interface AuthResultDTO {
  user: UserDTO;
  tokens: AuthTokensDTO;
}

export interface DeviceSessionDTO {
  id: string;
  client: string;
  deviceName: string | null;
  appVersion: string | null;
  lastActiveAt: string;
  createdAt: string;
  current: boolean;
}

// --- Brand -----------------------------------------------------------------
export interface BrandSummaryDTO {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  iconUrl: string | null;
  primaryColor: string;
  accentColor: string | null;
  isActive: boolean;
}

export interface BrandDetailDTO extends BrandSummaryDTO {
  description: string | null;
  coverUrl: string | null;
  secondaryColor: string | null;
  createdAt: string;
  stats: {
    activeCampaigns: number;
    totalCampaigns: number;
    influencers: number;
    contentCount: number;
    totalSpend: number;
    currency: string;
  };
}

// --- Social account --------------------------------------------------------
export interface FollowerPointDTO {
  followers: number | null;
  following: number | null;
  postCount: number | null;
  capturedAt: string;
}

export interface SocialAccountDTO {
  id: string;
  platform: Platform;
  username: string;
  profileUrl: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  followers: number | null;
  following: number | null;
  postCount: number | null;
  isVerified: boolean | null;
  isPrimary: boolean;
  followerDelta7d: number | null;
  provenance: ProvenanceDTO;
}

export interface AudienceSignalDTO {
  key: string;
  severity: 'positive' | 'neutral' | 'warning';
  message: string;
}

export interface AudienceHealthDTO {
  label: AudienceHealthLabel;
  signals: AudienceSignalDTO[];
  dataPoints: number;
}

// --- Influencer ------------------------------------------------------------
export interface InfluencerSummaryDTO {
  id: string;
  displayName: string;
  primaryUsername: string | null;
  avatarUrl: string | null;
  primaryPlatform: Platform | null;
  country: string | null;
  category: string | null;
  relationshipStatus: RelationshipStatus;
  priority: Priority;
  audienceHealth: AudienceHealthLabel;
  totalFollowers: number | null;
  platforms: Platform[];
  followersByPlatform: { platform: Platform; followers: number | null }[];
  tags: string[];
  activeCampaigns: number;
  isActive: boolean;
}

export interface InfluencerContactDTO {
  fullName: string | null;
  email: string | null;
  mobile: string | null;
  whatsapp: string | null;
  managerName: string | null;
  managerContact: string | null;
  preferredContact: ContactMethod | null;
}

export interface InfluencerRelationshipHistoryDTO {
  firstCollaborationAt: string | null;
  lastCollaborationAt: string | null;
  campaignCount: number;
  brandsWorkedWith: { id: string; name: string }[];
  totalPaid: number | null;
  averageRate: number | null;
  deliverablesPublished: number;
  deliverablesTotal: number;
}

export interface InfluencerDetailDTO extends InfluencerSummaryDTO {
  bio: string | null;
  city: string | null;
  languages: string[];
  pricingNotes: string | null;
  internalNotes: string | null;
  contact: InfluencerContactDTO;
  socialAccounts: SocialAccountDTO[];
  audience: AudienceHealthDTO;
  history: InfluencerRelationshipHistoryDTO;
  createdAt: string;
}

/** Result of resolving a pasted profile URL/handle (add-influencer preview). */
export interface ResolveProfileResultDTO {
  platform: Platform;
  username: string;
  profileUrl: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  postCount: number | null;
  isVerified: boolean | null;
  platformUserId: string | null;
  source: DataSource;
  manual: boolean;
  message: string | null;
}

export interface BrandInfluencerDTO {
  id: string;
  brand: BrandSummaryDTO;
  relationshipStatus: RelationshipStatus;
  priority: Priority;
  defaultRate: number | null;
  currency: string | null;
  totalCollaborations: number;
  lastCampaignAt: string | null;
  internalNotes: string | null;
  isActive: boolean;
}

// --- Campaign --------------------------------------------------------------
export interface CampaignProgressDTO {
  deliverablesTotal: number;
  deliverablesPublished: number;
  deliverableCompletion: number; // 0..100
  influencersTotal: number;
  influencersCompleted: number;
  timeElapsedPercent: number | null;
  spend: number;
  plannedBudget: number | null;
  budgetUsedPercent: number | null;
  daysRemaining: number | null;
}

export interface CampaignSummaryDTO {
  id: string;
  brandId: string;
  brand: BrandSummaryDTO;
  name: string;
  slug: string;
  coverUrl: string | null;
  status: CampaignStatus;
  objective: CampaignObjective | null;
  startDate: string | null;
  endDate: string | null;
  currency: string;
  plannedBudget: number | null;
  progress: CampaignProgressDTO;
}

export interface CampaignDetailDTO extends CampaignSummaryDTO {
  description: string | null;
  brief: string | null;
  targetMarket: string | null;
  internalNotes: string | null;
  owner: { id: string; name: string } | null;
  publishedContentCount: number;
  createdAt: string;
}

export interface DeliverableDTO {
  id: string;
  platform: Platform;
  type: DeliverableType;
  quantity: number;
  dueDate: string | null;
  status: DeliverableStatus;
  requirements: string | null;
  requiredHashtags: string[];
  requiredMentions: string[];
  scriptReferenceId: string | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  internalNotes: string | null;
  publishedContentCount: number;
}

export interface CampaignInfluencerDTO {
  id: string;
  campaignId: string;
  influencer: InfluencerSummaryDTO;
  dealType: DealType;
  agreedCost: number | null;
  currency: string | null;
  giftedProductValue: number | null;
  participationStatus: ParticipationStatus;
  paymentStatus: PaymentStatus;
  expectedPublishAt: string | null;
  dateContacted: string | null;
  notes: string | null;
  deliverables: DeliverableDTO[];
  deliverableProgress: { published: number; total: number };
}

// --- Scripts ---------------------------------------------------------------
export interface ScriptVersionDTO {
  id: string;
  version: number;
  body: string | null;
  captionSuggestion: string | null;
  talkingPoints: string[];
  dos: string[];
  donts: string[];
  requiredClaims: string[];
  hashtags: string[];
  mentions: string[];
  referenceLinks: string[];
  internalComments: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface ScriptDTO {
  id: string;
  title: string;
  campaignId: string | null;
  currentVersion: number;
  versions: ScriptVersionDTO[];
  updatedAt: string;
}

// --- Published content -----------------------------------------------------
export interface ContentMetricsDTO {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  reposts: number | null;
  saves: number | null;
  engagementRate: number | null;
  capturedAt: string | null;
  source: DataSource;
}

export interface MonitoringEventDTO {
  id: string;
  type: string;
  fromStatus: ContentStatus | null;
  toStatus: ContentStatus | null;
  message: string | null;
  success: boolean;
  checkedAt: string;
}

/**
 * Media-independent content representation (addendum §24-25). The API returns
 * normalized data + an embed descriptor; each client (Web now, Mobile later)
 * decides how to render it. Never returns frontend markup.
 */
export interface PublishedContentDTO {
  id: string;
  platform: Platform;
  externalId: string | null;
  originalUrl: string;
  canonicalUrl: string;
  embed: EmbedDescriptor | null;
  embeddable: boolean;
  thumbnailUrl: string | null;
  caption: string | null;
  publishedAt: string | null;
  detectedAt: string;
  availabilityStatus: ContentStatus;
  lastCheckedAt: string | null;
  lastMetricsSyncAt: string | null;
  provenance: ProvenanceDTO;
  influencer: InfluencerSummaryDTO | null;
  brand: BrandSummaryDTO | null;
  campaign: { id: string; name: string; slug: string } | null;
  metrics: ContentMetricsDTO | null;
}

// --- Costs -----------------------------------------------------------------
export interface ExpenseDTO {
  id: string;
  campaignId: string;
  campaignInfluencerId: string | null;
  type: ExpenseType;
  label: string | null;
  amount: number;
  currency: string;
  paymentStatus: PaymentStatus;
  incurredAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CostSummaryDTO {
  currency: string;
  plannedBudget: number | null;
  totalSpend: number;
  influencerFees: number;
  giftValue: number;
  otherExpenses: number;
  paid: number;
  unpaid: number;
  budgetUsedPercent: number | null;
}

// --- Notifications ---------------------------------------------------------
export interface NotificationDTO {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string | null;
  targetUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

// --- Activity --------------------------------------------------------------
export interface ActivityDTO {
  id: string;
  type: string;
  message: string;
  actorName: string | null;
  createdAt: string;
  link: string | null;
}

// --- Attachments -----------------------------------------------------------
export type AttachmentKind = 'image' | 'video' | 'pdf' | 'document' | 'other';

export interface AttachmentDTO {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
  /** Presigned S3 URL (absolute) or an API proxy path for the local driver. */
  downloadUrl: string;
  isImage: boolean;
  uploadedByName: string | null;
  createdAt: string;
}

/** Phase-1 upload ticket returned by POST /files (two-phase signed upload). */
export interface UploadTicketDTO {
  /** Opaque signed token to present to the blob endpoint and to /files/complete. */
  uploadToken: string;
  /** Where to PUT the bytes: an absolute presigned S3 URL, or a relative API path. */
  uploadUrl: string;
  method: 'PUT';
  /** true when uploadUrl is a direct-to-storage presigned URL (S3), false for the local proxy. */
  direct: boolean;
  /** Headers the client must send on the PUT (e.g. Content-Type for S3). */
  headers: Record<string, string>;
  maxBytes: number;
}

// --- Notes -----------------------------------------------------------------
export interface NoteDTO {
  id: string;
  body: string;
  influencerId: string | null;
  brandId: string | null;
  authorName: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

// --- Calendar --------------------------------------------------------------
export interface CalendarEventDTO {
  id: string;
  kind: 'CAMPAIGN_START' | 'CAMPAIGN_END' | 'DELIVERABLE_DUE' | 'EXPECTED_PUBLISH' | 'PUBLISHED';
  title: string;
  date: string;
  platform: Platform | null;
  brandName: string | null;
  brandColor: string | null;
  campaignId: string | null;
  influencerName: string | null;
  link: string;
}

// --- Search ----------------------------------------------------------------
export interface SearchResultDTO {
  type: 'influencer' | 'campaign' | 'brand' | 'published_content';
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  link: string;
}

// --- Integrations ----------------------------------------------------------
export interface IntegrationCapabilityDTO {
  platform: Platform;
  profileLookup: string;
  followerSync: string;
  contentLookup: string;
  contentEmbed: string;
  contentMetrics: string;
  availabilityMonitoring: string;
  requiresCreatorAuthorization: boolean;
  requiresAppAuthorization: boolean;
  manualFallback: boolean;
  apiConfigured: boolean;
  notes: string;
}

export interface IntegrationDTO {
  platform: Platform;
  status: IntegrationStatus;
  isEnabled: boolean;
  monitoringEnabled: boolean;
  lastTestAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  capabilities: IntegrationCapabilityDTO;
}

// --- Dashboard / Mission Control -------------------------------------------
export interface PulseDTO {
  activeCampaigns: number;
  activeInfluencers: number;
  contentPublishedThisWeek: number;
  upcomingDeliverables: number;
  overdueDeliverables: number;
  totalSpend: number;
  currency: string;
  contentAlerts: number;
}

export interface AttentionItemDTO {
  id: string;
  kind:
    | 'DELIVERABLE_OVERDUE'
    | 'CONTENT_REMOVED'
    | 'CONTENT_UNAVAILABLE'
    | 'SYNC_FAILURE'
    | 'CAMPAIGN_ENDING'
    | 'OVER_BUDGET'
    | 'MISSING_LINK';
  title: string;
  description: string;
  severity: 'warning' | 'danger';
  link: string;
  at: string;
}

export interface WhatsNewItemDTO {
  id: string;
  kind: 'CONTENT_PUBLISHED' | 'INFLUENCER_ADDED' | 'CAMPAIGN_LAUNCHED' | 'CAMPAIGN_COMPLETED' | 'FOLLOWER_MILESTONE' | 'CONTENT_REMOVED' | 'DEADLINE_APPROACHING';
  at: string;
  content?: PublishedContentDTO;
  title: string;
  subtitle: string | null;
  link: string;
}

export interface ActiveCampaignCardDTO {
  campaign: CampaignSummaryDTO;
}

export interface UpcomingContentDTO {
  id: string;
  influencerName: string;
  influencerAvatarUrl: string | null;
  platform: Platform;
  campaignName: string;
  brandName: string;
  expectedAt: string;
}

export interface GlobalDashboardDTO {
  pulse: PulseDTO;
  whatsNew: WhatsNewItemDTO[];
  attention: AttentionItemDTO[];
  activeCampaigns: ActiveCampaignCardDTO[];
  upcomingContent: UpcomingContentDTO[];
  recentActivity: ActivityDTO[];
}

export interface BrandDashboardDTO extends GlobalDashboardDTO {
  brand: BrandDetailDTO;
}

// --- Reports ---------------------------------------------------------------
export interface ReportColumnDTO {
  key: string;
  label: string;
  type: 'string' | 'number' | 'currency' | 'percent' | 'date';
}
export interface ReportDTO {
  type: string;
  columns: ReportColumnDTO[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, number | null>;
  currency: string;
}

// --- Platform & API / mobile readiness -------------------------------------
export type FeatureStatus = 'READY' | 'PARTIAL' | 'PLANNED' | 'ADMIN_SERVER_ONLY' | 'NOT_EXPOSED';
export type FeatureClass = 'SHARED' | 'WEB_ONLY_BY_DESIGN' | 'MOBILE_ONLY_BY_DESIGN' | 'ADMIN_DESKTOP_ONLY';

export interface FeatureDTO {
  key: string;
  name: string;
  description: string;
  module: string;
  classification: FeatureClass;
  apiStatus: FeatureStatus;
  webStatus: FeatureStatus;
  mobileReady: boolean;
  permissions: UserRole[];
  flag: string | null;
  minApiVersion: string;
  apiEndpoints: string[];
  deepLink: string | null;
}

export interface ApiModuleDTO {
  key: string;
  name: string;
  apiReady: boolean;
  webIntegrated: boolean;
  mobileReady: boolean;
  version: string;
  endpointCount: number;
  docsPath: string;
}

export interface HealthComponentDTO {
  name: string;
  status: 'ok' | 'degraded' | 'down' | 'unknown';
  detail?: string;
}

export interface PlatformStatusDTO {
  apiVersion: string;
  backendVersion: string;
  webVersion: string;
  environment: string;
  apiBaseUrl: string;
  health: HealthComponentDTO[];
  mobileReadinessPercent: number;
  coverage: {
    totalFeatures: number;
    apiReady: number;
    webReady: number;
    mobileReady: number;
    adminOnly: number;
  };
}

/** Object-storage configuration & usage (admin Settings → Storage). */
export interface StorageStatusDTO {
  driver: 's3' | 'local';
  /** Always true — objects are private; access is via signed, expiring URLs. */
  privateByDefault: boolean;
  bucket: string | null;
  endpoint: string | null;
  maxUploadMb: number;
  allowedMimeTypes: string[];
  objectCount: number;
  totalBytes: number;
}

export interface ApiEndpointDTO {
  method: string;
  path: string;
  module: string;
  summary: string;
  version: string;
  auth: 'public' | 'user' | 'admin';
}
