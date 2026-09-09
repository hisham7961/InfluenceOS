/**
 * String-union mirrors of the Prisma enums (browser-safe) plus human-facing
 * label maps and semantic tone hints used by UI badges. Values MUST match the
 * Prisma schema literals exactly.
 */

export const USER_ROLES = ['ADMIN', 'STAFF'] as const;
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
  'OTHER',
] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];

export const DELIVERABLE_STATUSES = [
  'PLANNED',
  'SENT_TO_INFLUENCER',
  'AWAITING_PUBLICATION',
  'PUBLISHED',
  'VERIFIED',
  'MISSED',
  'CANCELLED',
] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

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
  'GENERAL',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

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
export const DELIVERABLE_TYPE_LABELS = labelMap(DELIVERABLE_TYPES);
export const DELIVERABLE_STATUS_LABELS = labelMap(DELIVERABLE_STATUSES);
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
  PUBLISHED: 'success',
  VERIFIED: 'accent',
  MISSED: 'danger',
  CANCELLED: 'neutral',
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
