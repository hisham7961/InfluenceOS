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
  RoleProfile,
  Capability,
  LogisticsIssueType,
  LogisticsIssueStatus,
  AddressHealth,
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
  /** Advanced Roles pass — optional finer-grained profile; null = legacy. */
  roleProfile: RoleProfile | null;
  avatarUrl: string | null;
  locale: string;
  theme: string;
  /** Preferred content discovery layout (timeline/brand/grid/masonry/feed) — null = client default. */
  contentLayout: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
}

/** A single line of the human-readable "this user can / cannot" permission
 *  preview (Advanced Roles pass) — shown to an admin before saving, so a
 *  permission mistake is caught before it happens, never a raw JSON dump. */
export interface CapabilityPreviewLineDTO {
  capability: Capability;
  label: string;
  granted: boolean;
  /** True when this capability comes from an explicit override rather than the Role Profile default. */
  isOverride: boolean;
}

/** Full admin-facing view of one user's access (Advanced Roles pass) — Role
 *  Profile, explicit capability overrides, brand scope, country scope, and
 *  the resolved effective permission preview, all in one response so the
 *  Admin Users edit UI needs no N+1 fetching. */
export interface UserAdminDetailDTO extends UserDTO {
  brandIds: string[];
  countryCodes: string[];
  capabilityOverrides: { capability: Capability; granted: boolean }[];
  effectiveCapabilities: Capability[];
  permissionPreview: CapabilityPreviewLineDTO[];
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
  /** Canonical country code (Advanced Roles & Logistics Operations pass) —
   *  distinct from the free-text `country` on InfluencerSummaryDTO; drives
   *  country scoping/filtering. Editable independently of any one shipment. */
  countryCode: string | null;
  /** The creator's DEFAULT shipping address, reused as a starting point for a
   *  new shipment — a shipment always COPIES these into its own columns at
   *  creation time, so editing this here never rewrites a past shipment. */
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  deliveryInstructions: string | null;
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
  requiresProduct: boolean;
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
 * Dry-run preview of a bulk influencer-directory action (Operations
 * Intelligence, PART 53) — computed with the SAME per-row validation
 * `execute` will use, so the counts a manager confirms are exactly what
 * happens. Reuses `BulkRowResultDTO`'s shape (`status` here means "would be
 * added/skipped", never "failed" — a row that would error is reported as
 * skipped with a reason).
 */
export interface BulkPreviewDTO {
  selected: number;
  willUpdate: number;
  willSkip: number;
  /** Of `willUpdate`, how many would CREATE a brand-new record (vs. update/attach
   *  an existing one) — e.g. a CSV-import row with no existing-influencer match.
   *  Optional: only the CSV-import preview populates it (W3-4 gap #7); other bulk
   *  previews (roster add, influencer-directory actions) never create new records. */
  willCreate?: number;
  rows: BulkRowResultDTO[];
}

/** One product line item on a shipment (Logistics, evolved from W3-5). */
export interface ShipmentItemDTO {
  id: string;
  productName: string;
  sku: string | null;
  variant: string | null;
  quantity: number;
}

/**
 * A logistics fulfilment request (evolved from W3-5's "one shipment per
 * campaign-influencer" gift record): where a product is going, how, and
 * whether it arrived. A CampaignInfluencer may have several — one per
 * deliverable that needs a product, plus general/replacement shipments — so
 * `campaignInfluencerId` is NOT a 1:1 key any more. `deliverableId` is the
 * optional link back to the specific deliverable this fulfils.
 */
export interface LogisticsIssueDTO {
  id: string;
  shipmentId: string;
  type: LogisticsIssueType;
  status: LogisticsIssueStatus;
  description: string;
  createdById: string | null;
  createdByName: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  resolvedById: string | null;
  resolvedByName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ProductShipmentDTO {
  id: string;
  campaignInfluencerId: string;
  deliverableId: string | null;
  recipientName: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  country: string | null;
  /** Canonical destination country — a historical snapshot, independent of the influencer's own countryCode. */
  destinationCountryCode: string | null;
  postalCode: string | null;
  deliveryInstructions: string | null;
  courier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus;
  /** The logistics operator responsible for fulfilling this request. */
  assignedToUserId: string | null;
  assignedToName: string | null;
  createdById: string | null;
  createdByName: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
  items: ShipmentItemDTO[];
  /** Derived, never stored — see the AddressHealth doc comment. */
  addressHealth: AddressHealth;
  /** The current OPEN issue blocking this shipment, if any — never folded into `status`. */
  openIssue: LogisticsIssueDTO | null;
  createdAt: string;
  updatedAt: string;
}

/** A shipment as shown in the cross-campaign `/logistics` workspace — carries
 *  enough context (creator/brand/campaign) to be useful without a second
 *  lookup; still the same underlying ProductShipment row, never a copy. */
export interface LogisticsRequestDTO extends ProductShipmentDTO {
  influencer: { id: string; displayName: string; avatarUrl: string | null; countryCode: string | null } | null;
  brand: { id: string; name: string } | null;
  campaign: { id: string; name: string } | null;
  deliverableType: DeliverableType | null;
}

/** Per-destination-country counts for the Logistics workspace's country-first
 *  summary strip (Advanced Roles & Logistics Operations pass) — respects the
 *  viewer's own country/brand scope and every active filter except the
 *  country facet itself. `countryCode: null` buckets shipments with no
 *  destination country recorded yet. */
export interface LogisticsCountrySummaryDTO {
  countryCode: string | null;
  countryName: string | null;
  total: number;
  needsAttention: number;
}

/** Per-country counts for the Influencer Directory's country-first summary
 *  strip (item 80/81 — "All Creators 284, Kuwait 126…" clickable into the
 *  same directory's countryCode filter) — respects the viewer's own
 *  brand/country scope and every active filter except the country facet
 *  itself. `countryCode: null` buckets creators with no country on file yet. */
export interface InfluencerCountrySummaryDTO {
  countryCode: string | null;
  countryName: string | null;
  total: number;
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
/**
 * The current user's own New/Seen/Reviewed/Review-Later state for one piece
 * of content — never shared across users (UserContentState is keyed by
 * (userId, publishedContentId); see packages/shared contentReviewStatus for
 * the NEW/SEEN/REVIEWED derivation from these four timestamps).
 */
export interface ContentViewerStateDTO {
  firstSeenAt: string | null;
  lastOpenedAt: string | null;
  reviewedAt: string | null;
  savedForLaterAt: string | null;
}

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
  /** Which deliverable this content fulfills, if any — null for independent/unlinked content. */
  deliverable: { id: string; type: DeliverableType; platform: Platform } | null;
  metrics: ContentMetricsDTO | null;
  /** null only when the request has no authenticated actor (never in practice — every content route requires auth). */
  viewerState: ContentViewerStateDTO | null;
}

// --- Content Command Center (per-user summary + brand aggregation) ---------
export interface ContentDailySummaryDTO {
  total: number;
  new: number;
  seen: number;
  reviewed: number;
  alerts: number;
  brandsActive: number;
}

export interface BrandContentSummaryDTO {
  brandId: string;
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  today: number;
  new: number;
  alerts: number;
  latestContentAt: string | null;
}

export interface ContentSummaryDTO {
  new: number;
  seen: number;
  reviewed: number;
  reviewLater: number;
  unassigned: number;
  alerts: number;
  today: ContentDailySummaryDTO;
  brands: BrandContentSummaryDTO[];
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

// --- Collaboration (Notes/Comments/Chat) ------------------------------------
/** A user mentioned in a message — just enough to render "@Name" and link to them. */
export interface MentionRefDTO {
  userId: string;
  name: string;
}

/**
 * The shared Collaboration Layer message/comment shape — a "Note" attached to
 * exactly one context (influencer/brand/content/campaign/deliverable/
 * shipment/inspiration item, or a non-entity `channel` like "general"), a
 * pinned Manager Callout on content, a Campaign Chat message, or a reply one
 * level deep. `replies` is populated only on a top-level list fetch (never
 * recursively — replies don't carry their own `replies`).
 */
export interface NoteDTO {
  id: string;
  body: string;
  influencerId: string | null;
  brandId: string | null;
  publishedContentId: string | null;
  campaignId: string | null;
  deliverableId: string | null;
  shipmentId: string | null;
  inspirationItemId: string | null;
  channel: string | null;
  parentId: string | null;
  authorId: string | null;
  authorName: string | null;
  pinned: boolean;
  editedAt: string | null;
  /** True once soft-deleted — `body` is already replaced with "[deleted]" when this is true. */
  deleted: boolean;
  mentions: MentionRefDTO[];
  attachments: NoteAttachmentRefDTO[];
  createdAt: string;
  updatedAt: string;
  /** Only present on a top-level fetch; one level deep. */
  replies?: NoteDTO[];
}

/** A file attached to a Note/message — deliberately without a signed download
 *  URL (those expire; the client fetches one fresh via GET /files/:id, the
 *  same on-demand pattern AttachmentsPanel already uses, only when someone
 *  actually opens the file). */
export interface NoteAttachmentRefDTO {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
}

/** A lightweight team-directory entry for the @mention picker — no email/role/lockout fields. */
export interface TeamMemberRefDTO {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** Per-conversation unread state (Campaign Chat / General Team channels only — PART 16). */
export interface ConversationUnreadDTO {
  conversationKey: string;
  unreadCount: number;
  lastReadAt: string | null;
}

// --- Trends & Inspiration ----------------------------------------------------
export type InspirationCategory =
  | 'TREND'
  | 'HOOK'
  | 'UGC_STYLE'
  | 'PRODUCT_DEMO'
  | 'BEFORE_AFTER'
  | 'EDUCATIONAL'
  | 'STORYTELLING'
  | 'VIRAL_FORMAT'
  | 'COMPETITOR'
  | 'AUDIO_TREND'
  | 'OTHER';
export type InspirationStatus = 'ACTIVE' | 'ARCHIVED';

/**
 * External creative reference material the team shares for ideas — a viral
 * TikTok, a competitor's hook. Deliberately NOT PublishedContent: never
 * counted in content/creator analytics, and only the URL is stored (no
 * re-hosted copy of someone else's video).
 */
export interface InspirationItemDTO {
  id: string;
  url: string;
  platform: Platform | null;
  thumbnailUrl: string | null;
  title: string | null;
  note: string | null;
  category: InspirationCategory;
  tags: string[];
  brandId: string | null;
  brandName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  scriptReferenceId: string | null;
  scriptReferenceTitle: string | null;
  status: InspirationStatus;
  pinned: boolean;
  submittedById: string | null;
  submittedByName: string | null;
  commentCount: number;
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

/**
 * The ONE canonical operational-attention item shape (Operations Intelligence
 * pass, PART 55-57) — Mission Control, the Campaign Operations Board, Creator
 * 360 and the Operations page all render a slice of the SAME
 * `dashboard.attention()` output, filtered by brandId/campaignId/influencerId,
 * never a second calculation.
 */
export interface AttentionItemDTO {
  id: string;
  kind:
    | 'DELIVERABLE_OVERDUE'
    | 'CONTENT_REMOVED'
    | 'CONTENT_UNAVAILABLE'
    | 'SYNC_FAILURE'
    | 'CAMPAIGN_ENDING'
    | 'OVER_BUDGET'
    | 'MISSING_LINK'
    | 'UNASSIGNED_CONTENT'
    | 'SHIPMENT_FAILED'
    | 'SHIPMENT_RETURNED'
    | 'USAGE_RIGHT_EXPIRING'
    | 'CAMPAIGN_MISSING_OWNER'
    | 'UGC_AWAITING_REVIEW'
    | 'CREATOR_MISSING_INFO'
    | 'INTEGRITY_ISSUE'
    | 'LOGISTICS_ADDRESS_ISSUE';
  title: string;
  description: string;
  severity: 'warning' | 'danger';
  link: string;
  at: string;
  brandId: string | null;
  campaignId: string | null;
  influencerId: string | null;
  /** Short imperative label for the primary action ("Resolve", "Assign owner", "Review draft"). */
  actionLabel: string | null;
}

export interface WhatsNewItemDTO {
  id: string;
  kind:
    | 'CONTENT_PUBLISHED'
    | 'INFLUENCER_ADDED'
    | 'CAMPAIGN_LAUNCHED'
    | 'CAMPAIGN_COMPLETED'
    | 'FOLLOWER_MILESTONE'
    | 'CONTENT_REMOVED'
    | 'DEADLINE_APPROACHING'
    | 'DELIVERABLE_OVERDUE'
    | 'SHIPMENT_DELIVERED'
    | 'SUBMISSION_APPROVED'
    | 'USAGE_RIGHT_EXPIRING';
  at: string;
  content?: PublishedContentDTO;
  title: string;
  subtitle: string | null;
  link: string;
}

/**
 * "Since your last visit" summary (Content Command Center pass) — a small
 * set of REAL, already-recorded event counts since the user's own
 * lastWhatsNewViewedAt checkpoint, never a raw ActivityLog dump and never a
 * fabricated category. Each count is 0 when that event type didn't occur —
 * the web layer only renders lines with count > 0.
 */
export interface WhatsNewSummaryDTO {
  since: string | null;
  newContent: number;
  campaignsLaunched: number;
  contentAlerts: number;
  overdueDeliverables: number;
  shipmentsDelivered: number;
  submissionsApproved: number;
  usageRightsExpiring: number;
  items: WhatsNewItemDTO[];
  byBrand: { brandId: string; brandName: string; updates: number; newContent: number; alerts: number }[];
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
  /** "Since your last visit" — see WhatsNewSummaryDTO. Reuses the same underlying data as `whatsNew`. */
  whatsNewSummary: WhatsNewSummaryDTO;
  attention: AttentionItemDTO[];
  activeCampaigns: ActiveCampaignCardDTO[];
  upcomingContent: UpcomingContentDTO[];
  recentActivity: ActivityDTO[];
  /** Reuses GET /content/summary — powers the "Review New Content" CTA's count. */
  contentSummary: ContentSummaryDTO;
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
  /** Fees/expenses recorded but not yet (fully) paid — UNPAID + PARTIALLY_PAID (Operations Intelligence). */
  unpaidSpend: number;
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

/** Day-over-day digest — the trailing 24-hour window (W6-3, extended by Operations Intelligence). */
export interface ExecDigestDTO {
  /** ISO timestamp the window opens at (24h before generation). */
  since: string;
  contentPublished: number;
  deliverablesCompleted: number;
  campaignsCreated: number;
  campaignsCompleted: number;
  rosterAdditions: number;
  contentRemoved: number;
  shipmentsDelivered: number;
  shipmentsFailed: number;
  ugcAwaitingReview: number;
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

// --- Creator 360 (Operations Intelligence pass) -----------------------------

/**
 * Facts-only relationship snapshot for the Creator 360 summary header (PART
 * 27-28) — every field is a real aggregate, never a fabricated score.
 */
export interface CreatorSnapshotDTO {
  ownerName: string | null;
  brandsWorkedWith: number;
  totalCollaborations: number;
  currentCampaigns: number;
  lastCollaborationAt: string | null;
  lastContactAt: string | null;
  /** Min/max of non-null `defaultRate`/`agreedCost` seen for this creator, when any exist. */
  rateRange: { min: number; max: number; currency: string } | null;
  outstandingPayment: number;
  currency: string;
  activeDeliverables: number;
  activeShipments: number;
  /** Open Address Clarification issues across every shipment for this
   *  creator (Advanced Roles & Logistics Operations pass) — the SAME
   *  LogisticsIssue records the Logistics workspace shows, surfaced here as
   *  a warning banner rather than a copy. Empty when nothing is open. */
  openLogisticsIssues: {
    id: string;
    shipmentId: string;
    type: LogisticsIssueType;
    description: string;
    createdAt: string;
  }[];
  /** The creator's most recently updated shipment, for an at-a-glance
   *  "current shipment / delivery status / destination country" — reuses
   *  the same ProductShipment row every other view reads. */
  mostRecentShipment: {
    id: string;
    status: ShipmentStatus;
    destinationCountryCode: string | null;
    courier: string | null;
    trackingNumber: string | null;
    updatedAt: string;
  } | null;
}

/**
 * Deliverable-timeliness evidence (PART 31) — derived from real completed
 * deliverables only (`publishedAt` vs `dueDate`); a creator with no history
 * of BOTH a due date and a completion gets `sampleSize: 0` rather than a
 * fabricated rate.
 */
export interface CreatorReliabilityDTO {
  sampleSize: number;
  onTime: number;
  late: number;
  /** Average delay in days across the late ones only; null when `late === 0`. */
  averageDelayDays: number | null;
}

/** One entry in the Creator Master Timeline (PART 29) — reuses ActivityLog, Note and Notification rows; never a duplicate history table. */
export interface CreatorTimelineItemDTO {
  id: string;
  /** Coarse bucket for the Creator Timeline's filter chips (PART 30).
   *  'contacted' (CampaignInfluencer.dateContacted) and 'usageRights'
   *  (UsageRight.createdAt) were added to close gap #12 — see
   *  creator360.service.ts's timeline() for how each is derived. */
  bucket: 'campaign' | 'content' | 'ugc' | 'logistics' | 'payment' | 'collaboration' | 'activity' | 'contacted' | 'usageRights';
  message: string;
  link: string | null;
  at: string;
}

// --- Campaign Operations Board (Operations Intelligence pass) --------------

export type CampaignOperationsStageState = 'done' | 'pending' | 'overdue' | 'waiting' | 'na';

export interface CampaignOperationsStageDTO {
  key: 'agreement' | 'product' | 'contentDue' | 'draft' | 'review' | 'approved' | 'published' | 'payment';
  label: string;
  state: CampaignOperationsStageState;
  detail: string | null;
  link: string | null;
}

/**
 * One influencer's row on the Campaign Operations Board (PART 33-35) — every
 * stage is DERIVED from existing CampaignInfluencer/Deliverable/Submission/
 * ProductShipment/PublishedContent/payment records at read time. No new
 * per-stage status column is ever stored.
 */
export interface CampaignOperationsRowDTO {
  campaignInfluencerId: string;
  influencerId: string;
  influencerName: string;
  influencerAvatarUrl: string | null;
  participationStatus: ParticipationStatus;
  stages: CampaignOperationsStageDTO[];
  /** A coarse bucket for the board's filter chips (PART 36), derived from `stages`. */
  filterBuckets: (
    | 'needsAttention'
    | 'onTrack'
    | 'overdue'
    | 'waitingForProduct'
    | 'waitingForCreator'
    | 'inReview'
    | 'readyToPublish'
    | 'published'
    | 'paymentPending'
    | 'completed'
  )[];
}

export interface CampaignOperationsBoardDTO {
  campaignId: string;
  rows: CampaignOperationsRowDTO[];
}

// --- Data Quality & Duplicate Detection (Operations Intelligence pass) -----

export type DataQualitySeverity = 'critical' | 'needsAttention' | 'incomplete' | 'informational';

/** One missing/incomplete-data finding category (PART 41-44) — a count, never a row-per-record payload; the count deep-links to the filtered records. */
export interface DataQualityFindingDTO {
  id: string;
  title: string;
  severity: DataQualitySeverity;
  count: number;
  link: string;
  /** Short label for the contextual fix action, when one exists (PART 44). */
  fixLabel: string | null;
}

export interface DataQualityReportDTO {
  findings: DataQualityFindingDTO[];
  generatedAt: string;
}

export type DuplicateMatchConfidence = 'exact' | 'strongPossible' | 'possible';

/** One reason a candidate is a possible duplicate (PART 46) — shown so the user can judge for themselves, never an opaque "this is a duplicate" verdict. */
export interface DuplicateMatchReasonDTO {
  field: 'instagramUsername' | 'tiktokUsername' | 'youtubeUsername' | 'snapchatUsername' | 'xUsername' | 'email' | 'mobile' | 'whatsapp' | 'name';
  value: string;
}

export interface DuplicateCandidateDTO {
  influencerId: string;
  displayName: string;
  avatarUrl: string | null;
  confidence: DuplicateMatchConfidence;
  reasons: DuplicateMatchReasonDTO[];
}

// --- Workflow Integrity Guard (Operations Intelligence pass) ---------------

export type IntegrityRuleId =
  | 'CONTENT_CAMPAIGN_DELIVERABLE_MISMATCH'
  | 'CONTENT_INFLUENCER_DELIVERABLE_MISMATCH'
  | 'DELIVERABLE_MISSING_LOGISTICS'
  | 'SUBMISSION_DELIVERABLE_MISMATCH'
  | 'CAMPAIGN_COMPLETED_WITH_OVERDUE_DELIVERABLES'
  | 'PAID_AMOUNT_EXCEEDS_AGREED_COST'
  | 'USAGE_RIGHT_BRAND_MISMATCH';

/**
 * One detected relational inconsistency (PART 64-67) — read-only: the Guard
 * only reports, it never repairs. `evidence` is a short, human-readable
 * explanation of what was found and why it's inconsistent.
 */
export interface IntegrityFindingDTO {
  id: string;
  rule: IntegrityRuleId;
  severity: 'error' | 'warning';
  title: string;
  evidence: string;
  link: string;
  detectedAt: string;
}
