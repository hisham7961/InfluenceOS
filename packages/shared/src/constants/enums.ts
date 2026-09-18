/**
 * String-union mirrors of the Prisma enums (browser-safe) plus human-facing
 * label maps and semantic tone hints used by UI badges. Values MUST match the
 * Prisma schema literals exactly.
 */

// VIEWER is a read-only operator (W4-4): full read access, no mutations.
export const USER_ROLES = ['ADMIN', 'STAFF', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const DATA_SOURCES = ['MANUAL', 'OFFICIAL_API', 'EMBED', 'UNAVAILABLE'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export const RELATIONSHIP_STATUSES = [
  'PROSPECT',
  'CONTACTED',
  'NEGOTIATING',
  'ACTIVE',
  'RECURRING',
  'PAST',
  'DECLINED',
  'BLACKLISTED',
] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CONTACT_METHODS = ['WHATSAPP', 'EMAIL', 'PHONE', 'INSTAGRAM_DM', 'OTHER'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const AUDIENCE_HEALTH_LABELS = ['HEALTHY', 'REVIEW', 'LIMITED_DATA'] as const;
export type AudienceHealthLabel = (typeof AUDIENCE_HEALTH_LABELS)[number];

export const CAMPAIGN_STATUSES = [
  'DRAFT',
  'PLANNING',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_OBJECTIVES = [
  'AWARENESS',
  'ENGAGEMENT',
  'CONVERSIONS',
  'LAUNCH',
  'UGC',
  'OTHER',
] as const;
export type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];

export const DEAL_TYPES = ['FREE', 'PAID', 'GIFTED_PRODUCT', 'PAID_PLUS_GIFTED'] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export const PARTICIPATION_STATUSES = [
  'INVITED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'DECLINED',
  'DROPPED',
] as const;
export type ParticipationStatus = (typeof PARTICIPATION_STATUSES)[number];

export const DELIVERABLE_TYPES = [
  'POST',
  'STORY',
  'REEL',
  'SHORT',
  'VIDEO',
  'LIVE',
  'TWEET',
  'SNAP',
  'CAROUSEL',
  // Owned UGC asset (no public social post required) — completes via approval.
  'UGC',
  'OTHER',
] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];

export const DELIVERABLE_STATUSES = [
  'PLANNED',
  'SENT_TO_INFLUENCER',
  'AWAITING_PUBLICATION',
  // Review/approval lifecycle (W3-1): a draft can be in review, sent back for
  // changes, or approved. APPROVED is a completion state — a UGC deliverable
  // reaches it without ever having a public social URL.
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'PUBLISHED',
  'VERIFIED',
  'MISSED',
  'CANCELLED',
] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

/** Review lifecycle of a single deliverable submission (draft) — W3-1. */
export const SUBMISSION_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** A reviewer's decision on a submission. */
export const SUBMISSION_DECISIONS = ['APPROVE', 'REQUEST_CHANGES', 'REJECT'] as const;
export type SubmissionDecision = (typeof SUBMISSION_DECISIONS)[number];

export const CONTENT_STATUSES = [
  'LIVE',
  'REMOVED',
  'PRIVATE',
  'UNAVAILABLE',
  'BROKEN_LINK',
  'UNKNOWN',
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'NOT_APPLICABLE',
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const EXPENSE_TYPES = [
  'INFLUENCER_FEE',
  'GIFT_PRODUCT',
  'PRODUCTION',
  'ADS',
  'SHIPPING',
  'OTHER',
] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

export const NOTIFICATION_CATEGORIES = [
  'CONTENT_REMOVED',
  'CONTENT_UNAVAILABLE',
  'DELIVERABLE_OVERDUE',
  'DELIVERABLE_DUE_SOON',
  'CAMPAIGN_ENDING',
  'SYNC_FAILURE',
  'NEW_CONTENT',
  'FOLLOWER_MILESTONE',
  'USAGE_RIGHT_EXPIRING',
  'GENERAL',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** What a usage-rights license permits the brand to do with content (W3-2). */
export const USAGE_RIGHT_TYPES = [
  'ORGANIC',
  'PAID_ADS',
  'WHITELISTING',
  'BROADCAST',
  'OTHER',
] as const;
export type UsageRightType = (typeof USAGE_RIGHT_TYPES)[number];

/** Stored lifecycle of a usage-rights license. */
export const USAGE_RIGHT_STATUSES = ['ACTIVE', 'EXPIRED', 'REVOKED'] as const;
export type UsageRightStatus = (typeof USAGE_RIGHT_STATUSES)[number];

/**
 * Effective (derived, never stored) status shown in the UI: an ACTIVE license
 * whose `expiresAt` falls inside the alert window reads EXPIRING_SOON so ad
 * spend is never planned on rights about to lapse.
 */
export const USAGE_RIGHT_EFFECTIVE_STATUSES = [
  'ACTIVE',
  'EXPIRING_SOON',
  'EXPIRED',
  'REVOKED',
] as const;
export type UsageRightEffectiveStatus = (typeof USAGE_RIGHT_EFFECTIVE_STATUSES)[number];

/** Days before `expiresAt` at which an ACTIVE license is flagged EXPIRING_SOON. */
export const USAGE_RIGHT_EXPIRY_WARNING_DAYS = 14;

/**
 * Sourcing-pipeline stage for a creator considered for a campaign, BEFORE any
 * roster commit (W3-3). Evaluating candidates never inflates relationship
 * history; only CONVERTED creates the roster row.
 */
export const CANDIDATE_STATUSES = [
  'CONSIDERING',
  'SHORTLISTED',
  'APPROVED',
  'REJECTED',
  'CONVERTED',
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/** A reviewer's decision on a sourcing candidate. */
export const CANDIDATE_DECISIONS = ['SHORTLIST', 'APPROVE', 'REJECT', 'RECONSIDER'] as const;
export type CandidateDecision = (typeof CANDIDATE_DECISIONS)[number];

/** Fulfilment status of a product-seeding shipment (W3-5). */
export const SHIPMENT_STATUSES = [
  'PENDING',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'RETURNED',
  'FAILED',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const INTEGRATION_STATUSES = ['ENABLED', 'DISABLED', 'NOT_CONFIGURED', 'ERROR'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/** Visual tone used by the Badge component. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Build a label map from an enum array using title-casing, with overrides. */
function labelMap<T extends string>(
  values: readonly T[],
  overrides: Partial<Record<T, string>> = {},
): Record<T, string> {
  const out = {} as Record<T, string>;
  for (const v of values) out[v] = overrides[v] ?? humanize(v);
  return out;
}

export const RELATIONSHIP_STATUS_LABELS = labelMap(RELATIONSHIP_STATUSES);
export const DEAL_TYPE_LABELS = labelMap(DEAL_TYPES, {
  FREE: 'Free',
  PAID: 'Paid',
  GIFTED_PRODUCT: 'Gifted Product',
  PAID_PLUS_GIFTED: 'Paid + Gifted',
});
export const CAMPAIGN_STATUS_LABELS = labelMap(CAMPAIGN_STATUSES);
export const CAMPAIGN_OBJECTIVE_LABELS = labelMap(CAMPAIGN_OBJECTIVES, { UGC: 'UGC' });
export const PARTICIPATION_STATUS_LABELS = labelMap(PARTICIPATION_STATUSES);
export const DELIVERABLE_TYPE_LABELS = labelMap(DELIVERABLE_TYPES, { UGC: 'UGC' });
export const DELIVERABLE_STATUS_LABELS = labelMap(DELIVERABLE_STATUSES);
export const SUBMISSION_STATUS_LABELS = labelMap(SUBMISSION_STATUSES);
export const USAGE_RIGHT_TYPE_LABELS = labelMap(USAGE_RIGHT_TYPES);
export const USAGE_RIGHT_STATUS_LABELS = labelMap(USAGE_RIGHT_STATUSES);
export const USAGE_RIGHT_EFFECTIVE_STATUS_LABELS = labelMap(USAGE_RIGHT_EFFECTIVE_STATUSES);
export const CANDIDATE_STATUS_LABELS = labelMap(CANDIDATE_STATUSES);
export const SHIPMENT_STATUS_LABELS = labelMap(SHIPMENT_STATUSES);
export const CONTENT_STATUS_LABELS = labelMap(CONTENT_STATUSES, { BROKEN_LINK: 'Broken Link' });
export const PAYMENT_STATUS_LABELS = labelMap(PAYMENT_STATUSES);
export const EXPENSE_TYPE_LABELS = labelMap(EXPENSE_TYPES);
export const PRIORITY_LABELS = labelMap(PRIORITIES);
export const CONTACT_METHOD_LABELS = labelMap(CONTACT_METHODS, { INSTAGRAM_DM: 'Instagram DM' });
export const AUDIENCE_HEALTH_LABELS_MAP = labelMap(AUDIENCE_HEALTH_LABELS);
export const DATA_SOURCE_LABELS = labelMap(DATA_SOURCES, {
  OFFICIAL_API: 'Official API',
});

export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, Tone> = {
  DRAFT: 'neutral',
  PLANNING: 'info',
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'accent',
  CANCELLED: 'danger',
};

export const DELIVERABLE_STATUS_TONE: Record<DeliverableStatus, Tone> = {
  PLANNED: 'neutral',
  SENT_TO_INFLUENCER: 'info',
  AWAITING_PUBLICATION: 'warning',
  IN_REVIEW: 'info',
  CHANGES_REQUESTED: 'warning',
  APPROVED: 'success',
  PUBLISHED: 'success',
  VERIFIED: 'accent',
  MISSED: 'danger',
  CANCELLED: 'neutral',
};

export const SUBMISSION_STATUS_TONE: Record<SubmissionStatus, Tone> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'info',
  CHANGES_REQUESTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

export const CONTENT_STATUS_TONE: Record<ContentStatus, Tone> = {
  LIVE: 'success',
  REMOVED: 'danger',
  PRIVATE: 'warning',
  UNAVAILABLE: 'warning',
  BROKEN_LINK: 'danger',
  UNKNOWN: 'neutral',
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  NOT_APPLICABLE: 'neutral',
  UNPAID: 'warning',
  PARTIALLY_PAID: 'info',
  PAID: 'success',
};

export const RELATIONSHIP_STATUS_TONE: Record<RelationshipStatus, Tone> = {
  PROSPECT: 'neutral',
  CONTACTED: 'info',
  NEGOTIATING: 'info',
  ACTIVE: 'success',
  RECURRING: 'accent',
  PAST: 'neutral',
  DECLINED: 'warning',
  BLACKLISTED: 'danger',
};

export const AUDIENCE_HEALTH_TONE: Record<AudienceHealthLabel, Tone> = {
  HEALTHY: 'success',
  REVIEW: 'warning',
  LIMITED_DATA: 'neutral',
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'danger',
};

export const USAGE_RIGHT_EFFECTIVE_STATUS_TONE: Record<UsageRightEffectiveStatus, Tone> = {
  ACTIVE: 'success',
  EXPIRING_SOON: 'warning',
  EXPIRED: 'danger',
  REVOKED: 'neutral',
};

export const CANDIDATE_STATUS_TONE: Record<CandidateStatus, Tone> = {
  CONSIDERING: 'neutral',
  SHORTLISTED: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  CONVERTED: 'accent',
};

export const SHIPMENT_STATUS_TONE: Record<ShipmentStatus, Tone> = {
  PENDING: 'neutral',
  SHIPPED: 'info',
  IN_TRANSIT: 'info',
  DELIVERED: 'success',
  RETURNED: 'warning',
  FAILED: 'danger',
};
