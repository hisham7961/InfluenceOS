import type { EmbedDescriptor } from '@influenceos/shared';
import type {
  AudienceHealthLabel,
  CampaignObjective,
  CampaignStatus,
  CandidateStatus,
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
  ShipmentStatus,
  SubmissionStatus,
  UsageRightEffectiveStatus,
  UsageRightStatus,
  UsageRightType,
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
  isActive: boolean;
  lastLoginAt: string | null;
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
  /** Relationship owner / assignee (W4-5). */
  ownerId: string | null;
  ownerName: string | null;
  contact: InfluencerContactDTO;
  socialAccounts: SocialAccountDTO[];
  audience: AudienceHealthDTO;
  history: InfluencerRelationshipHistoryDTO;
  createdAt: string;
}

/**
 * One flat row of the influencer data export (CSV/JSON). Every field is a
 * scalar so it serializes cleanly to a CSV cell — collections (platforms,
 * languages, tags) are pre-joined into a single string by the export.
 */
export interface InfluencerExportRowDTO {
  id: string;
  displayName: string;
  fullName: string | null;
  primaryUsername: string | null;
  primaryPlatform: Platform | null;
  category: string | null;
  country: string | null;
  city: string | null;
  relationshipStatus: RelationshipStatus;
  priority: Priority;
  audienceHealth: AudienceHealthLabel;
  totalFollowers: number | null;
  /** Platforms the creator is present on, joined by "; ". */
  platforms: string;
  email: string | null;
  mobile: string | null;
  whatsapp: string | null;
  managerName: string | null;
  managerContact: string | null;
  preferredContact: ContactMethod | null;
  /** Spoken/content languages, joined by "; ". */
  languages: string;
  /** Directory tags, joined by "; ". */
  tags: string;
  /** Relationship owner / assignee name (W4-5). */
  ownerName: string | null;
  isActive: boolean;
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

/** A review comment on a deliverable submission (W3-1). */
export interface SubmissionCommentDTO {
  id: string;
  authorName: string | null;
  body: string;
  createdAt: string;
}

/** A creator's submission (draft/asset) against a deliverable, with its review
 *  lifecycle and comment thread (W3-1). Successive versions are revision rounds. */
export interface DeliverableSubmissionDTO {
  id: string;
  deliverableId: string;
  version: number;
  status: SubmissionStatus;
  notes: string | null;
  assetUrl: string | null;
  submittedByName: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
  comments: SubmissionCommentDTO[];
}

/**
 * A usage-rights license (W3-2): what content a brand may use, in what way,
 * where, and until when. `effectiveStatus` is derived at read time — an ACTIVE
 * license inside the expiry-warning window reads EXPIRING_SOON, and one whose
 * `expiresAt` has passed reads EXPIRED — so ad spend is never planned on rights
 * that have lapsed or are about to.
 */
export interface UsageRightDTO {
  id: string;
  brandId: string;
  campaignId: string | null;
  campaignName: string | null;
  influencerId: string | null;
  influencerName: string | null;
  publishedContentId: string | null;
  usageType: UsageRightType;
  scope: string | null;
  territory: string | null;
  exclusive: boolean;
  competitorRestriction: string | null;
  disclosureRequired: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  status: UsageRightStatus;
  effectiveStatus: UsageRightEffectiveStatus;
  daysUntilExpiry: number | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
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
  paidAmount: number | null;
  paidAt: string | null;
  expectedPublishAt: string | null;
  dateContacted: string | null;
  notes: string | null;
  deliverables: DeliverableDTO[];
  deliverableProgress: { published: number; total: number };
}

/**
 * A creator being sourced for a campaign — considered, shortlisted, approved or
 * rejected BEFORE any roster commit (W3-3). Only a CONVERTED candidate has a
 * roster row (`convertedCampaignInfluencerId`); until then it never affects the
 * influencer's collaboration history.
 */
export interface CampaignCandidateDTO {
  id: string;
  campaignId: string;
  influencer: InfluencerSummaryDTO;
  status: CandidateStatus;
  fitScore: number | null;
  notes: string | null;
  decisionReason: string | null;
  addedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  convertedCampaignInfluencerId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Per-row outcome of a bulk roster add or a CSV import (W3-4). */
export interface BulkRowResultDTO {
  /** The influencer this row referred to (resolved id, or null if unresolved). */
  influencerId: string | null;
  /** A human label for the row (display name / handle) for error reporting. */
  label: string | null;
  status: 'added' | 'skipped' | 'failed';
  /** The created roster/candidate id when status === 'added'. */
  id: string | null;
  message: string | null;
}

/** Summary + per-row results of a bulk roster add or CSV import (W3-4). */
export interface BulkResultDTO {
  added: number;
  skipped: number;
  failed: number;
  results: BulkRowResultDTO[];
}

/** Result of applying a deliverable template across a campaign roster (W3-4). */
export interface DeliverableTemplateResultDTO {
  rostersTargeted: number;
  deliverablesCreated: number;
}

/**
 * Product-seeding shipment on a gift record (W3-5): where the product is going,
 * how, and whether it arrived. Attached 1:1 to a campaign-influencer.
 */
export interface ProductShipmentDTO {
  id: string;
  campaignInfluencerId: string;
  recipientName: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  country: string | null;
  postalCode: string | null;
  courier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus;
  shippedAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
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
  paidAmount: number | null;
  paidAt: string | null;
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

// --- Campaign efficiency (W6-1, server-computed — no browser metric math) ---

/** One content piece's server-computed efficiency line (W6-1). */
export interface ContentEfficiencyDTO {
  contentId: string;
  views: number | null;
  totalEngagement: number | null;
  engagementRate: number | null;
  /** Estimated cost per view: spend-per-content ÷ this piece's views. */
  costPerView: number | null;
  /** Provenance of this piece's latest metrics. */
  source: DataSource;
  /** When this piece's latest metrics were captured. */
  capturedAt: string | null;
}

/** How many content pieces carry each metric provenance (W6-1). */
export interface MetricSourceCountDTO {
  source: DataSource;
  count: number;
}

/**
 * Campaign spend-efficiency, computed entirely server-side (fixes ARCH-01): the
 * browser renders these numbers, it never derives them. Every value is null
 * when its inputs are missing — never a fabricated zero.
 */
export interface CampaignEfficiencyDTO {
  currency: string;
  totalSpend: number;
  contentCount: number;
  /** Content pieces that have at least one metric snapshot. */
  contentWithMetrics: number;
  totalViews: number | null;
  totalEngagement: number | null;
  avgEngagementRate: number | null;
  /** CPV — total spend ÷ total views. */
  costPerView: number | null;
  /** CPM — cost per 1,000 views. */
  costPerMille: number | null;
  /** CPE — total spend ÷ total engagements. */
  costPerEngagement: number | null;
  /** Total spend ÷ number of published content pieces. */
  costPerContent: number | null;
  /** Most recent metric sync across the campaign's content. */
  metricsLastSyncedAt: string | null;
  /** Metrics older than the freshness window (or never synced) → stale. */
  isStale: boolean;
  /** The freshness window used to decide `isStale`, in days. */
  freshnessWindowDays: number;
  /** Provenance breakdown across the campaign's measured content. */
  sources: MetricSourceCountDTO[];
  /** Per-content efficiency rows for the performance table. */
  perContent: ContentEfficiencyDTO[];
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

/** A search result with its relevance score and what matched (W3-6). */
export interface RankedSearchResultDTO extends SearchResultDTO {
  score: number;
  /** Which field produced the match: 'name' | 'username' | 'tag' | 'note' | 'caption' | 'url'. */
  matchedOn: string;
}

/** A full, ranked, paginated global-search results page (W3-6). */
export interface SearchPageDTO {
  results: RankedSearchResultDTO[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * A saved view / segment (W3-6): a named, optionally shared set of filters for a
 * given list scope (e.g. 'influencers', 'campaigns'). `isOwn` marks the caller's
 * own views; shared views from other users are read-only to non-owners.
 */
export interface SavedViewDTO {
  id: string;
  scope: string;
  name: string;
  filters: unknown;
  isShared: boolean;
  isOwn: boolean;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
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

/** INT-4 — masked status of one provider API credential (never the value). */
export interface ProviderCredentialStatusDTO {
  key: string;
  platform: Platform;
  /** Where the effective value resolves from right now. */
  source: 'DB' | 'ENV' | 'NONE';
  isSet: boolean;
  /** Masked hint (e.g. "••••AB12") so an admin can confirm which key is loaded. */
  last4: string | null;
  /** When the DB-stored value was last set (null for env/none). */
  updatedAt: string | null;
}

/** INT-3 — the authorize URL a creator visits to connect their account. */
export interface CreatorOAuthStartDTO {
  url: string;
}

/** INT-3 — a creator's OAuth connection state for one platform (never a token). */
export interface CreatorConnectionDTO {
  influencerId: string;
  platform: Platform;
  connected: boolean;
  externalUserId: string | null;
  scope: string | null;
  expiresAt: string | null;
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

/** Performance tier for a creator on the leaderboard (W6-2). */
export type CreatorTier = 'GOLD' | 'SILVER' | 'BRONZE' | 'NEW';

/** One creator's standing on the performance leaderboard (W6-2). */
export interface LeaderboardEntryDTO {
  influencerId: string;
  displayName: string;
  primaryUsername: string | null;
  avatarUrl: string | null;
  category: string | null;
  /** Committed campaign participations (invited-only never counts). */
  campaigns: number;
  /** Distinct brands the creator has delivered for. */
  brands: number;
  /** Committed campaigns beyond the first (0 for a one-off). */
  repeatCollaborations: number;
  deliverablesTotal: number;
  deliverablesPublished: number;
  /** published / total, or null when there are no deliverables yet. */
  completionRate: number | null;
  totalPaid: number | null;
  tier: CreatorTier;
  score: number;
}

/** Ranked creator performance leaderboard (W6-2). */
export interface CreatorLeaderboardDTO {
  entries: LeaderboardEntryDTO[];
  generatedAt: string;
}

// --- Executive dashboard (W6-3) --------------------------------------------

/** Aggregate spend against planned budget across the scoped brands (W6-3). */
export interface SpendVsBudgetDTO {
  currency: string;
  /** Sum of every scoped campaign's plannedBudget (a null budget counts as 0). */
  plannedBudget: number;
  totalSpend: number;
  /** plannedBudget − totalSpend; negative when spend has exceeded budget. */
  remaining: number;
  /** spend / plannedBudget as a rounded %, or null when no budget is set. */
  budgetUsedPercent: number | null;
  /** Campaigns whose own spend is strictly above their own plannedBudget. */
  campaignsOverBudget: number;
}

/** What happened "today" — since server-local midnight (W6-3). */
export interface ExecTodayDTO {
  /** Published content first detected today. */
  contentPublished: number;
  /** Open deliverables whose due date falls today. */
  deliverablesDue: number;
  /** Campaigns whose start date is today. */
  campaignsStarting: number;
  /** Campaigns whose end date is today. */
  campaignsEnding: number;
}

/** Day-over-day digest — the trailing 24-hour window (W6-3). */
export interface ExecDigestDTO {
  /** ISO timestamp the window opens at (24h before generation). */
  since: string;
  contentPublished: number;
  deliverablesCompleted: number;
  campaignsCreated: number;
  campaignsCompleted: number;
  rosterAdditions: number;
  contentRemoved: number;
}

/** One brand's health line in the cross-brand rollup (W6-3). */
export interface ExecBrandRollupDTO {
  brandId: string;
  brandName: string;
  slug: string;
  activeCampaigns: number;
  totalSpend: number;
  plannedBudget: number;
  budgetUsedPercent: number | null;
  overBudget: boolean;
  overdueDeliverables: number;
  contentAlerts: number;
  /** overdueDeliverables + contentAlerts + (overBudget ? 1 : 0) — the sort key. */
  issueCount: number;
}

/** Executive overview answering the 5 outstanding exec questions (W6-3). */
export interface ExecDashboardDTO {
  currency: string;
  spendVsBudget: SpendVsBudgetDTO;
  today: ExecTodayDTO;
  digest: ExecDigestDTO;
  /** Per-brand health, most-troubled first. */
  brands: ExecBrandRollupDTO[];
  generatedAt: string;
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
  /** Deployed build identity so an admin can confirm exactly which release is live. */
  gitSha: string;
  buildTime: string | null;
  uptimeSec: number;
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

/** Admin audit-log entry (GET /platform/audit) — richer than the activity feed. */
export type AuditEntityType = 'brand' | 'campaign' | 'influencer' | 'deliverable' | 'content';

export interface AuditEntryDTO {
  id: string;
  type: string;
  message: string;
  actorId: string | null;
  actorName: string | null;
  entityType: AuditEntityType | null;
  entityId: string | null;
  brandId: string | null;
  brandName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  link: string | null;
}

export interface ApiEndpointDTO {
  method: string;
  path: string;
  module: string;
  summary: string;
  version: string;
  auth: 'public' | 'user' | 'admin';
}
