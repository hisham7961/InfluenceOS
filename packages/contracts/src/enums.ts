/**
 * Client-safe enums (addendum §31). Re-exported from @influenceos/shared so
 * that the backend, the web client and future mobile clients all import the
 * exact same enum definitions from the contract package — never redefined.
 */
export {
  PLATFORMS,
  USER_ROLES,
  DATA_SOURCES,
  RELATIONSHIP_STATUSES,
  PRIORITIES,
  CONTACT_METHODS,
  AUDIENCE_HEALTH_LABELS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_OBJECTIVES,
  DEAL_TYPES,
  PARTICIPATION_STATUSES,
  DELIVERABLE_TYPES,
  DELIVERABLE_STATUSES,
  CONTENT_STATUSES,
  PAYMENT_STATUSES,
  EXPENSE_TYPES,
  NOTIFICATION_CATEGORIES,
  INTEGRATION_STATUSES,
} from '@influenceos/shared';

export type {
  Platform,
  UserRole,
  DataSource,
  RelationshipStatus,
  Priority,
  ContactMethod,
  AudienceHealthLabel,
  CampaignStatus,
  CampaignObjective,
  DealType,
  ParticipationStatus,
  DeliverableType,
  DeliverableStatus,
  ContentStatus,
  PaymentStatus,
  ExpenseType,
  NotificationCategory,
  IntegrationStatus,
  Tone,
} from '@influenceos/shared';

export const CLIENT_TYPES = ['WEB', 'IOS', 'ANDROID', 'API'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'PUSH', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const FEATURE_FLAG_SCOPES = ['PLATFORM', 'WEB', 'MOBILE', 'BRAND'] as const;
export type FeatureFlagScope = (typeof FEATURE_FLAG_SCOPES)[number];
