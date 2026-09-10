import { z } from 'zod';
import {
  PLATFORMS,
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_STATUSES,
  CONTACT_METHODS,
  CONTENT_STATUSES,
  DEAL_TYPES,
  DELIVERABLE_STATUSES,
  DELIVERABLE_TYPES,
  EXPENSE_TYPES,
  PARTICIPATION_STATUSES,
  PAYMENT_STATUSES,
  PRIORITIES,
  RELATIONSHIP_STATUSES,
  USER_ROLES,
} from '@influenceos/shared';

/**
 * All request DTO schemas + server-side filter/pagination contracts
 * (addendum §6, §28). These are the single validation authority shared by the
 * API and (for optimistic client validation) the web/mobile clients.
 */

const platformEnum = z.enum(PLATFORMS);
const cuid = z.string().min(1);
const optionalString = z.string().trim().max(5000).optional().nullable();
const shortString = z.string().trim().min(1).max(200);
const money = z.coerce.number().nonnegative().max(1_000_000_000).optional().nullable();
const isoDate = z.coerce.date().optional().nullable();
const stringArray = z.array(z.string().trim().min(1).max(120)).max(50).optional().default([]);
const hexColor = z.string().regex(/^#([0-9a-fA-F]{6})$/);

// --- Auth ------------------------------------------------------------------
export const deviceInfoSchema = z.object({
  client: z.enum(['WEB', 'IOS', 'ANDROID']).default('WEB'),
  deviceId: z.string().max(200).optional(),
  deviceName: z.string().max(200).optional(),
  appVersion: z.string().max(40).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  device: deviceInfoSchema.optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const registerUserSchema = z.object({
  email: z.string().email(),
  name: shortString,
  password: z.string().min(8).max(200),
  role: z.enum(USER_ROLES).default('STAFF'),
});

/** Strong-password rule for user-chosen passwords: length + mixed character
 *  classes. Kept deliberately simple (no external dependency). */
const strongPassword = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'Include upper- and lower-case letters and a number.',
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: strongPassword,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** UI preferences persisted on the user account (so they follow the user across
 *  devices and to future mobile clients). Both optional — a request updates only
 *  the fields it carries. */
export const updatePreferencesSchema = z
  .object({
    locale: z.enum(['en', 'ar']).optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
  })
  .refine((v) => v.locale !== undefined || v.theme !== undefined, {
    message: 'Provide a locale and/or a theme.',
  });
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

// --- Common query ----------------------------------------------------------
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  q: z.string().trim().max(200).optional(),
  sort: z.string().trim().max(60).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

// --- Brand -----------------------------------------------------------------
export const brandCreateSchema = z.object({
  name: shortString,
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(64).optional(),
  description: optionalString,
  logoUrl: optionalString,
  iconUrl: optionalString,
  coverUrl: optionalString,
  primaryColor: hexColor.default('#6366F1'),
  accentColor: hexColor.optional().nullable(),
  secondaryColor: hexColor.optional().nullable(),
  isActive: z.boolean().default(true),
});
export const brandUpdateSchema = brandCreateSchema.partial();
export type BrandCreateInput = z.infer<typeof brandCreateSchema>;

// --- Influencer ------------------------------------------------------------
export const influencerCreateSchema = z.object({
  displayName: shortString,
  fullName: optionalString,
  primaryUsername: optionalString,
  primaryPlatform: platformEnum.optional().nullable(),
  avatarOverrideUrl: optionalString,
  bio: optionalString,
  country: optionalString,
  city: optionalString,
  category: optionalString,
  languages: stringArray,
  email: z.string().email().optional().nullable().or(z.literal('')),
  mobile: optionalString,
  whatsapp: optionalString,
  managerName: optionalString,
  managerContact: optionalString,
  preferredContact: z.enum(CONTACT_METHODS).optional().nullable(),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  relationshipStatus: z.enum(RELATIONSHIP_STATUSES).default('PROSPECT'),
  pricingNotes: optionalString,
  internalNotes: optionalString,
  isActive: z.boolean().default(true),
  tags: stringArray,
});
export const influencerUpdateSchema = influencerCreateSchema.partial();
export type InfluencerCreateInput = z.infer<typeof influencerCreateSchema>;

export const resolveProfileSchema = z.object({
  input: z.string().trim().min(1).max(500),
  platform: platformEnum.optional().nullable(),
});
export type ResolveProfileInput = z.infer<typeof resolveProfileSchema>;

export const influencerFilterSchema = paginationSchema.extend({
  brandId: cuid.optional(),
  platform: platformEnum.optional(),
  country: z.string().max(80).optional(),
  category: z.string().max(80).optional(),
  tag: z.string().max(80).optional(),
  relationshipStatus: z.enum(RELATIONSHIP_STATUSES).optional(),
  minFollowers: z.coerce.number().int().min(0).optional(),
  maxFollowers: z.coerce.number().int().min(0).optional(),
  dealHistory: z.enum(['FREE', 'PAID', 'ANY']).optional(),
  active: z.coerce.boolean().optional(),
  campaignId: cuid.optional(),
});
export type InfluencerFilter = z.infer<typeof influencerFilterSchema>;

// --- Social account --------------------------------------------------------
export const socialAccountCreateSchema = z.object({
  influencerId: cuid,
  platform: platformEnum,
  username: shortString,
  profileUrl: optionalString,
  platformUserId: optionalString,
  displayName: optionalString,
  avatarUrl: optionalString,
  bio: optionalString,
  followers: z.coerce.number().int().min(0).optional().nullable(),
  following: z.coerce.number().int().min(0).optional().nullable(),
  postCount: z.coerce.number().int().min(0).optional().nullable(),
  isVerified: z.boolean().optional().nullable(),
  isPrimary: z.boolean().default(false),
});
export const socialAccountUpdateSchema = socialAccountCreateSchema.partial().omit({
  influencerId: true,
});

// --- Brand ↔ Influencer ----------------------------------------------------
export const brandInfluencerSchema = z.object({
  brandId: cuid,
  influencerId: cuid,
  relationshipStatus: z.enum(RELATIONSHIP_STATUSES).default('PROSPECT'),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  internalNotes: optionalString,
  defaultRate: money,
  currency: z.string().max(8).optional().nullable(),
  isActive: z.boolean().default(true),
});

// --- Campaign --------------------------------------------------------------
export const campaignCreateSchema = z.object({
  brandId: cuid,
  name: shortString,
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(64).optional(),
  coverUrl: optionalString,
  description: optionalString,
  brief: optionalString,
  objective: z.enum(CAMPAIGN_OBJECTIVES).optional().nullable(),
  status: z.enum(CAMPAIGN_STATUSES).default('DRAFT'),
  startDate: isoDate,
  endDate: isoDate,
  currency: z.string().max(8).default('KWD'),
  plannedBudget: money,
  targetMarket: optionalString,
  ownerId: cuid.optional().nullable(),
  internalNotes: optionalString,
});
export const campaignUpdateSchema = campaignCreateSchema.partial().omit({ brandId: true });
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

export const campaignFilterSchema = paginationSchema.extend({
  brandId: cuid.optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  objective: z.enum(CAMPAIGN_OBJECTIVES).optional(),
  ownerId: cuid.optional(),
});
export type CampaignFilter = z.infer<typeof campaignFilterSchema>;

// --- Campaign influencer ---------------------------------------------------
export const campaignInfluencerCreateSchema = z.object({
  campaignId: cuid,
  influencerId: cuid,
  dealType: z.enum(DEAL_TYPES).default('PAID'),
  agreedCost: money,
  currency: z.string().max(8).optional().nullable(),
  giftedProductValue: money,
  dateContacted: isoDate,
  expectedPublishAt: isoDate,
  participationStatus: z.enum(PARTICIPATION_STATUSES).default('INVITED'),
  paymentStatus: z.enum(PAYMENT_STATUSES).default('NOT_APPLICABLE'),
  notes: optionalString,
});
export const campaignInfluencerUpdateSchema = campaignInfluencerCreateSchema
  .partial()
  .omit({ campaignId: true, influencerId: true });

// --- Deliverable -----------------------------------------------------------
export const deliverableCreateSchema = z.object({
  campaignInfluencerId: cuid,
  platform: platformEnum,
  type: z.enum(DELIVERABLE_TYPES),
  quantity: z.coerce.number().int().min(1).max(100).default(1),
  dueDate: isoDate,
  requirements: optionalString,
  requiredHashtags: stringArray,
  requiredMentions: stringArray,
  scriptReferenceId: cuid.optional().nullable(),
  status: z.enum(DELIVERABLE_STATUSES).default('PLANNED'),
  publishedUrl: optionalString,
  publishedAt: isoDate,
  internalNotes: optionalString,
});
export const deliverableUpdateSchema = deliverableCreateSchema
  .partial()
  .omit({ campaignInfluencerId: true });

// --- Script reference + version -------------------------------------------
export const scriptVersionSchema = z.object({
  body: optionalString,
  captionSuggestion: optionalString,
  talkingPoints: stringArray,
  dos: stringArray,
  donts: stringArray,
  requiredClaims: stringArray,
  hashtags: stringArray,
  mentions: stringArray,
  referenceLinks: stringArray,
  internalComments: optionalString,
});
export const scriptCreateSchema = z
  .object({
    campaignId: cuid.optional().nullable(),
    deliverableId: cuid.optional().nullable(),
    title: shortString,
  })
  .merge(scriptVersionSchema);
export const scriptVersionCreateSchema = scriptVersionSchema;
export type ScriptCreateInput = z.infer<typeof scriptCreateSchema>;

// --- Published content -----------------------------------------------------
export const publishedContentCreateSchema = z.object({
  url: z.string().trim().url().max(1000),
  campaignId: cuid.optional().nullable(),
  brandId: cuid.optional().nullable(),
  influencerId: cuid.optional().nullable(),
  campaignInfluencerId: cuid.optional().nullable(),
  deliverableId: cuid.optional().nullable(),
  caption: optionalString,
  publishedAt: isoDate,
});
export const publishedContentUpdateSchema = z.object({
  caption: optionalString,
  campaignId: cuid.optional().nullable(),
  influencerId: cuid.optional().nullable(),
  deliverableId: cuid.optional().nullable(),
  availabilityStatus: z.enum(CONTENT_STATUSES).optional(),
  publishedAt: isoDate,
});

export const contentMetricSchema = z.object({
  views: z.coerce.number().int().min(0).optional().nullable(),
  likes: z.coerce.number().int().min(0).optional().nullable(),
  comments: z.coerce.number().int().min(0).optional().nullable(),
  shares: z.coerce.number().int().min(0).optional().nullable(),
  reposts: z.coerce.number().int().min(0).optional().nullable(),
  saves: z.coerce.number().int().min(0).optional().nullable(),
});

export const contentFilterSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  brandId: cuid.optional(),
  campaignId: cuid.optional(),
  influencerId: cuid.optional(),
  platform: platformEnum.optional(),
  status: z.enum(CONTENT_STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(200).optional(),
});
export type ContentFilter = z.infer<typeof contentFilterSchema>;

// --- Expense ---------------------------------------------------------------
export const expenseCreateSchema = z.object({
  campaignId: cuid,
  campaignInfluencerId: cuid.optional().nullable(),
  type: z.enum(EXPENSE_TYPES),
  label: optionalString,
  amount: z.coerce.number().nonnegative().max(1_000_000_000),
  currency: z.string().max(8).default('KWD'),
  paymentStatus: z.enum(PAYMENT_STATUSES).default('UNPAID'),
  incurredAt: isoDate,
  notes: optionalString,
});
export const expenseUpdateSchema = expenseCreateSchema.partial().omit({ campaignId: true });

// --- Attachments ------------------------------------------------------------
/** Target association for an attachment (at least one is required). */
export const attachmentTargetSchema = z.object({
  campaignId: cuid.optional().nullable(),
  deliverableId: cuid.optional().nullable(),
  scriptReferenceId: cuid.optional().nullable(),
  influencerId: cuid.optional().nullable(),
  noteId: cuid.optional().nullable(),
});
export const attachmentListQuerySchema = attachmentTargetSchema;
export type AttachmentTarget = z.infer<typeof attachmentTargetSchema>;

/** Phase-1 request: declare the file, get back a signed upload ticket. */
export const attachmentInitiateSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.coerce.number().int().positive().max(500 * 1024 * 1024),
  target: attachmentTargetSchema,
});
export type AttachmentInitiate = z.infer<typeof attachmentInitiateSchema>;

/** Phase-2 request: confirm the upload landed and create the record. */
export const attachmentCompleteSchema = z.object({
  uploadToken: z.string().min(1),
});

// --- Note ------------------------------------------------------------------
export const noteCreateSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  influencerId: cuid.optional().nullable(),
  brandId: cuid.optional().nullable(),
  pinned: z.boolean().default(false),
});

// --- Notifications ---------------------------------------------------------
export const notificationFilterSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z.coerce.boolean().optional(),
});
export const markReadSchema = z.object({
  ids: z.array(cuid).min(1).max(200).optional(),
  all: z.boolean().optional(),
});

// --- Activity feed ---------------------------------------------------------
export const activityFilterSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  brandId: cuid.optional(),
  campaignId: cuid.optional(),
  influencerId: cuid.optional(),
});

// --- Admin audit log -------------------------------------------------------
/** Server-side filters for GET /platform/audit (admin only). */
export const auditFilterSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  actorId: cuid.optional(),
  type: z.string().trim().max(64).optional(),
  entityType: z.enum(['brand', 'campaign', 'influencer', 'deliverable', 'content']).optional(),
  entityId: z.string().trim().max(64).optional(),
  brandId: cuid.optional(),
  campaignId: cuid.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(200).optional(),
});
export type AuditFilter = z.infer<typeof auditFilterSchema>;

// --- Reports ---------------------------------------------------------------
export const reportFilterSchema = z.object({
  type: z.enum(['campaign', 'influencer', 'brand', 'content', 'spend']).default('campaign'),
  brandId: cuid.optional(),
  campaignId: cuid.optional(),
  platform: platformEnum.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

// --- Calendar --------------------------------------------------------------
export const calendarQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  brandId: cuid.optional(),
  campaignId: cuid.optional(),
  influencerId: cuid.optional(),
  platform: platformEnum.optional(),
});
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

// --- Search ----------------------------------------------------------------
export const searchSchema = z.object({
  q: z.string().trim().min(1).max(200),
  brandId: cuid.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

// --- Integration settings --------------------------------------------------
export const integrationUpdateSchema = z.object({
  isEnabled: z.boolean().optional(),
  monitoringEnabled: z.boolean().optional(),
  config: z.record(z.string(), z.any()).optional(),
});

// --- Feature flags / client config (admin) --------------------------------
export const featureFlagUpdateSchema = z.object({
  enabled: z.boolean(),
});
export const clientConfigUpdateSchema = z.object({
  maintenanceMode: z.boolean().optional(),
  maintenanceMessage: optionalString,
  defaultLanguage: z.enum(['en', 'ar']).optional(),
  supportedLanguages: z.array(z.enum(['en', 'ar'])).optional(),
  maxUploadMb: z.coerce.number().int().min(1).max(500).optional(),
  supportInfo: optionalString,
});
export const appVersionUpdateSchema = z.object({
  recommendedVersion: optionalString,
  minimumVersion: optionalString,
  storeUrl: optionalString,
  forceUpdate: z.boolean().optional(),
  maintenanceMessage: optionalString,
});

export { z };
