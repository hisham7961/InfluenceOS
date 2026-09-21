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
  SUBMISSION_DECISIONS,
  USAGE_RIGHT_TYPES,
  CANDIDATE_DECISIONS,
  SHIPMENT_STATUSES,
  USER_ROLES,
  INSPIRATION_CATEGORIES,
  INSPIRATION_STATUSES,
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

// --- Safe display URLs (SEC-01: stored-XSS defence) ------------------------
// User-supplied URL fields (profile links, image/cover URLs, published-post
// URLs) are later rendered as href/src. A value that declares a dangerous
// scheme — `javascript:`, `data:`, `vbscript:`, `file:`, … — must never be
// stored. We reject at write time (defence in depth; the web also sanitises at
// render). Control/zero-width characters are stripped first so a scheme cannot
// be smuggled past the check (e.g. `java\tscript:`), then any value that
// declares a scheme must declare http(s); scheme-less/relative values (which
// cannot execute script) are allowed.
const URL_SMUGGLE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g;

export function isSafeDisplayUrl(raw: string): boolean {
  const s = raw.replace(URL_SMUGGLE_CHARS, '').trim();
  if (s === '') return true;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s);
  if (!scheme) return true; // relative / scheme-less — cannot execute script
  const p = (scheme[1] ?? '').toLowerCase();
  return p === 'http' || p === 'https';
}

/** True only for an absolute http(s) URL (used where a URL is required). */
export function isHttpUrl(raw: string): boolean {
  const s = raw.replace(URL_SMUGGLE_CHARS, '').trim();
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const SAFE_URL_MESSAGE = 'Enter a valid link (http/https or a relative path).';

/** Optional, nullable user-supplied display URL, scheme-guarded (SEC-01). */
const safeUrl = optionalString.refine((v) => v == null || isSafeDisplayUrl(v), {
  message: SAFE_URL_MESSAGE,
});

/** Required absolute http(s) URL (rejects `javascript:` which `z.url()` allows). */
const httpUrl = z
  .string()
  .trim()
  .max(1000)
  .refine(isHttpUrl, { message: 'Enter a valid http(s) URL.' });

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

// --- Admin user lifecycle (W4-1) -------------------------------------------
export const userAdminUpdateSchema = z
  .object({
    name: shortString.optional(),
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.role !== undefined || v.isActive !== undefined, {
    message: 'Provide at least one field to update.',
  });
/** An admin sets a new password for another user (no current-password check). */
export const adminResetPasswordSchema = z.object({ newPassword: strongPassword });
export type UserAdminUpdateInput = z.infer<typeof userAdminUpdateSchema>;
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;

/**
 * Replace a user's brand scope (W4-4). An empty list clears the scope, making
 * the user unscoped again (they see every brand).
 */
export const brandAccessSetSchema = z.object({ brandIds: z.array(cuid).max(500).default([]) });
export type BrandAccessSetInput = z.infer<typeof brandAccessSetSchema>;

/** UI preferences persisted on the user account (so they follow the user across
 *  devices and to future mobile clients). Both optional — a request updates only
 *  the fields it carries. */
export const updatePreferencesSchema = z
  .object({
    locale: z.enum(['en', 'ar']).optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    contentLayout: z.enum(['timeline', 'brand', 'grid', 'masonry', 'feed']).optional(),
  })
  .refine((v) => v.locale !== undefined || v.theme !== undefined || v.contentLayout !== undefined, {
    message: 'Provide a locale, theme and/or content layout.',
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
  logoUrl: safeUrl,
  iconUrl: safeUrl,
  coverUrl: safeUrl,
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
  avatarOverrideUrl: safeUrl,
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
  // Relationship owner / assignee (W4-5).
  ownerId: cuid.optional().nullable(),
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

// Influencer data export (CSV/JSON). Reuses the directory filters so an export
// mirrors exactly what the user is looking at, but drops offset pagination —
// the whole matching set is streamed (bounded server-side). `format` picks the
// wire format; the CSV is the default because this endpoint's job is a file.
export const influencerExportSchema = influencerFilterSchema
  .omit({ page: true, pageSize: true })
  .extend({ format: z.enum(['csv', 'json']).default('csv') });
export type InfluencerExportQuery = z.infer<typeof influencerExportSchema>;

// Cursor-paginated influencer directory (W7-2). Same filters, but keyset paging
// (stable under inserts) instead of offset. `cursor` is the last row's id.
export const influencerCursorSchema = influencerFilterSchema.extend({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export type InfluencerCursorQuery = z.infer<typeof influencerCursorSchema>;

// --- Social account --------------------------------------------------------
export const socialAccountCreateSchema = z.object({
  influencerId: cuid,
  platform: platformEnum,
  username: shortString,
  profileUrl: safeUrl,
  platformUserId: optionalString,
  displayName: optionalString,
  avatarUrl: safeUrl,
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
  coverUrl: safeUrl,
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

// Cursor-paginated campaign directory (W7-2).
export const campaignCursorSchema = campaignFilterSchema.extend({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export type CampaignCursorQuery = z.infer<typeof campaignCursorSchema>;

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
  // How much of the agreed fee has actually been paid — required for correct
  // AP reporting when paymentStatus is PARTIALLY_PAID (finance P1). Missing =
  // null (unknown), FREE/NOT_APPLICABLE keeps it null.
  paidAmount: money,
  paidAt: isoDate,
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
  publishedUrl: safeUrl,
  publishedAt: isoDate,
  internalNotes: optionalString,
  /** Logistics: does completing this deliverable require shipping a physical product? */
  requiresProduct: z.coerce.boolean().default(false),
});
export const deliverableUpdateSchema = deliverableCreateSchema
  .partial()
  .omit({ campaignInfluencerId: true });

// --- Deliverable submissions (review / approval, W3-1) ---------------------
export const submissionCreateSchema = z.object({
  notes: optionalString,
  // Link to the draft/owned asset — never a required public post. Scheme-guarded.
  assetUrl: safeUrl,
});
export const submissionReviewSchema = z.object({
  decision: z.enum(SUBMISSION_DECISIONS),
  note: optionalString,
});
export const submissionCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});
export type SubmissionCreateInput = z.infer<typeof submissionCreateSchema>;
export type SubmissionReviewInput = z.infer<typeof submissionReviewSchema>;

// --- Usage rights (content-licensing ledger + expiry alerts, W3-2) ---------
export const usageRightCreateSchema = z.object({
  campaignId: cuid.optional().nullable(),
  influencerId: cuid.optional().nullable(),
  publishedContentId: cuid.optional().nullable(),
  usageType: z.enum(USAGE_RIGHT_TYPES).default('ORGANIC'),
  scope: optionalString,
  territory: z.string().trim().max(200).optional().nullable(),
  exclusive: z.boolean().optional().default(false),
  competitorRestriction: optionalString,
  disclosureRequired: z.boolean().optional().default(false),
  startsAt: isoDate,
  expiresAt: isoDate,
  notes: optionalString,
});
export const usageRightUpdateSchema = usageRightCreateSchema.partial();
export type UsageRightCreateInput = z.infer<typeof usageRightCreateSchema>;
export type UsageRightUpdateInput = z.infer<typeof usageRightUpdateSchema>;

// --- Sourcing / shortlist candidate pipeline (W3-3) ------------------------
const fitScore = z.coerce.number().int().min(0).max(100).optional().nullable();

export const candidateCreateSchema = z.object({
  influencerId: cuid,
  fitScore,
  notes: optionalString,
});
export const candidateUpdateSchema = z.object({
  fitScore,
  notes: optionalString,
});
export const candidateDecisionSchema = z.object({
  decision: z.enum(CANDIDATE_DECISIONS),
  reason: optionalString,
});
/**
 * Commit an approved candidate to the campaign roster. Mirrors the roster
 * `add` deal fields, minus campaignId/influencerId (taken from the candidate).
 */
export const candidateConvertSchema = z.object({
  dealType: z.enum(DEAL_TYPES).optional(),
  agreedCost: money,
  currency: z.string().trim().length(3).optional().nullable(),
  giftedProductValue: money,
  expectedPublishAt: isoDate,
});
export type CandidateCreateInput = z.infer<typeof candidateCreateSchema>;
export type CandidateUpdateInput = z.infer<typeof candidateUpdateSchema>;
export type CandidateDecisionInput = z.infer<typeof candidateDecisionSchema>;
export type CandidateConvertInput = z.infer<typeof candidateConvertSchema>;

// --- Bulk roster ops + deliverable templates (W3-4) ------------------------
/** One row of a bulk roster add: the roster deal fields for a single creator. */
export const bulkRosterRowSchema = campaignInfluencerCreateSchema.omit({ campaignId: true });
/** Add up to 200 creators to a campaign roster in one request. */
export const bulkRosterAddSchema = z.object({
  rows: z.array(bulkRosterRowSchema).min(1).max(200),
});
/** One deliverable spec in a template (no campaignInfluencerId — it is fanned out). */
export const deliverableTemplateItemSchema = deliverableCreateSchema.omit({
  campaignInfluencerId: true,
});
/**
 * Apply a set of deliverables to many roster members at once. `target` is
 * either every roster member ('all') or an explicit list of campaign-influencer
 * ids (each validated to belong to the campaign).
 */
export const deliverableTemplateSchema = z.object({
  target: z.union([z.literal('all'), z.array(cuid).min(1).max(500)]).default('all'),
  deliverables: z.array(deliverableTemplateItemSchema).min(1).max(50),
});
export type BulkRosterRowInput = z.infer<typeof bulkRosterRowSchema>;
export type BulkRosterAddInput = z.infer<typeof bulkRosterAddSchema>;
export type DeliverableTemplateInput = z.infer<typeof deliverableTemplateSchema>;

/**
 * Import a list of creators from a CSV as sourcing candidates (W3-4). Columns
 * (header row, case-insensitive): displayName|name (required), fullName,
 * username|handle, platform, email, category, country, fitScore, notes.
 * Unknown creators are created; existing ones are matched by (platform,
 * username) then display name.
 */
export const candidateCsvImportSchema = z.object({
  csv: z.string().min(1).max(1_000_000),
});
export type CandidateCsvImportInput = z.infer<typeof candidateCsvImportSchema>;

// --- Logistics / shipment tracking (W3-5, evolved into multi-shipment Logistics) --
/** One product line item on a shipment — resolved/created by name within the brand. */
export const shipmentItemInputSchema = z.object({
  productName: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(120).optional().nullable(),
  variant: z.string().trim().max(120).optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(100_000).default(1),
});

/**
 * Create a logistics fulfilment request against a CampaignInfluencer. NOT an
 * upsert any more — a CampaignInfluencer may have several independent
 * shipments (one per deliverable that needs a product, a replacement
 * shipment, etc). `deliverableId` is optional: a general campaign-level gift
 * has none. Address/recipient fields are a point-in-time copy — the caller
 * (web) prefills them from the influencer's current shipping profile, but
 * changing that profile later never rewrites this record.
 */
export const shipmentCreateSchema = z.object({
  deliverableId: cuid.optional().nullable(),
  recipientName: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  addressLine1: z.string().trim().max(300).optional().nullable(),
  addressLine2: z.string().trim().max(300).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  country: z.string().trim().max(120).optional().nullable(),
  postalCode: z.string().trim().max(40).optional().nullable(),
  deliveryInstructions: z.string().trim().max(500).optional().nullable(),
  courier: z.string().trim().max(120).optional().nullable(),
  trackingNumber: z.string().trim().max(120).optional().nullable(),
  trackingUrl: httpUrl.optional().nullable(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  shippedAt: isoDate,
  deliveredAt: isoDate,
  notes: optionalString,
  items: z.array(shipmentItemInputSchema).max(50).default([]),
});
/** Update fulfilment details on an existing shipment — never its campaignInfluencerId/deliverableId/items (fixed at creation). */
export const shipmentUpdateSchema = shipmentCreateSchema.omit({ deliverableId: true, items: true }).partial();
/** Advance only the fulfilment status (courier webhook / quick action). */
export const shipmentStatusSchema = z.object({
  status: z.enum(SHIPMENT_STATUSES),
});
/** Cross-campaign logistics workspace filters (the `/logistics` page). */
export const shipmentFilterSchema = z.object({
  status: z.enum(SHIPMENT_STATUSES).optional(),
  brandId: cuid.optional(),
  campaignId: cuid.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ShipmentCreateInput = z.infer<typeof shipmentCreateSchema>;
export type ShipmentUpdateInput = z.infer<typeof shipmentUpdateSchema>;
export type ShipmentStatusInput = z.infer<typeof shipmentStatusSchema>;
export type ShipmentFilterInput = z.infer<typeof shipmentFilterSchema>;

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
  url: httpUrl,
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
  // Derived assignment status (see contentAssociationStatus in @influenceos/shared)
  // filtered server-side so pagination stays correct — never a stored column.
  assignment: z.enum(['FULLY_LINKED', 'CAMPAIGN_LINKED', 'INFLUENCER_LINKED', 'UNASSIGNED']).optional(),
  // Current-user review state (Content Command Center pass) — filtered
  // server-side against UserContentState scoped to the caller, so pagination
  // stays correct and one user's filter can never leak another's state.
  reviewState: z.enum(['NEW', 'SEEN', 'REVIEWED', 'REVIEW_LATER']).optional(),
  // The "Alerts" filter chip — any availability status that needs attention,
  // server-side so pagination stays correct (matches REMOVED_STATUSES).
  alertsOnly: z.coerce.boolean().optional(),
});
export type ContentFilter = z.infer<typeof contentFilterSchema>;

// Mark seen / reviewed / review-later on one piece of content, scoped to the
// calling user. `seen: true` is what the Viewer/detail page sends on open —
// idempotent (firstSeenAt is set once, lastOpenedAt always advances).
export const contentViewStateSchema = z
  .object({
    seen: z.literal(true).optional(),
    reviewed: z.boolean().optional(),
    reviewLater: z.boolean().optional(),
  })
  .refine((v) => v.seen !== undefined || v.reviewed !== undefined || v.reviewLater !== undefined, {
    message: 'Provide at least one of seen, reviewed or reviewLater.',
  });
export type ContentViewStateInput = z.infer<typeof contentViewStateSchema>;

// The client passes its OWN local day boundary (not computed server-side in
// UTC) so "today" in the daily summary always matches the user's actual
// timezone-correct Timeline grouping — see docs on ContentDailySummaryDTO.
export const contentSummaryQuerySchema = z.object({
  todayStart: z.coerce.date().optional(),
  todayEnd: z.coerce.date().optional(),
});
export type ContentSummaryQuery = z.infer<typeof contentSummaryQuerySchema>;

// --- Expense ---------------------------------------------------------------
export const expenseCreateSchema = z.object({
  campaignId: cuid,
  campaignInfluencerId: cuid.optional().nullable(),
  type: z.enum(EXPENSE_TYPES),
  label: optionalString,
  amount: z.coerce.number().nonnegative().max(1_000_000_000),
  currency: z.string().max(8).default('KWD'),
  paymentStatus: z.enum(PAYMENT_STATUSES).default('UNPAID'),
  paidAmount: money,
  paidAt: isoDate,
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

// --- Collaboration (Notes / comments / chat) --------------------------------
// The shared Collaboration Layer primitive — a create call sets exactly one
// context field (or `parentId`, which inherits its parent's context) and
// `mentionedUserIds` is explicit, structured data from the composer's @mention
// picker, never parsed out of free text server-side (avoids ambiguous-name
// false matches).
const NOTE_CHANNELS = ['general'] as const;
export const noteCreateSchema = z
  .object({
    body: z.string().trim().min(1).max(5000),
    influencerId: cuid.optional().nullable(),
    brandId: cuid.optional().nullable(),
    publishedContentId: cuid.optional().nullable(),
    campaignId: cuid.optional().nullable(),
    deliverableId: cuid.optional().nullable(),
    shipmentId: cuid.optional().nullable(),
    inspirationItemId: cuid.optional().nullable(),
    channel: z.enum(NOTE_CHANNELS).optional().nullable(),
    parentId: cuid.optional().nullable(),
    pinned: z.boolean().default(false),
    mentionedUserIds: z.array(cuid).max(30).optional().default([]),
  })
  .refine(
    (v) =>
      !!(
        v.influencerId ||
        v.brandId ||
        v.publishedContentId ||
        v.campaignId ||
        v.deliverableId ||
        v.shipmentId ||
        v.inspirationItemId ||
        v.channel ||
        v.parentId
      ),
    {
      message: 'A message must be attached to a context (influencer, brand, content, campaign, deliverable, shipment, trend, or a channel) or be a reply.',
    },
  );
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;

/** Body-only edit — pin/unpin has its own authorization rule and its own endpoint (PART 8). */
export const noteEditSchema = z.object({ body: z.string().trim().min(1).max(5000) });
export const notePinSchema = z.object({ pinned: z.boolean() });

/** List a context's top-level messages (with one level of replies inlined) — cursor-paginated for Campaign/General chat, which can grow large. Exactly one context field identifies the thread, same as noteCreateSchema. */
export const noteListQuerySchema = z
  .object({
    influencerId: cuid.optional(),
    brandId: cuid.optional(),
    publishedContentId: cuid.optional(),
    campaignId: cuid.optional(),
    deliverableId: cuid.optional(),
    shipmentId: cuid.optional(),
    inspirationItemId: cuid.optional(),
    channel: z.enum(NOTE_CHANNELS).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .refine(
    (v) =>
      !!(v.influencerId || v.brandId || v.publishedContentId || v.campaignId || v.deliverableId || v.shipmentId || v.inspirationItemId || v.channel),
    { message: 'A context (influencer, brand, content, campaign, deliverable, shipment, trend, or channel) is required.' },
  );
export type NoteListQuery = z.infer<typeof noteListQuerySchema>;

export const mentionsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z.coerce.boolean().optional(),
});

export const conversationReadSchema = z.object({
  conversationKey: z.string().trim().min(1).max(200),
});

/** Comma-separated `conversationKey`s (the same strings `<CommentThread>` already marks read) to fetch unread counts for. */
export const conversationUnreadQuerySchema = z.object({
  keys: z.string().trim().min(1).max(2000),
});

// --- Trends & Inspiration ----------------------------------------------------
export const inspirationCreateSchema = z.object({
  url: httpUrl,
  platform: platformEnum.optional().nullable(),
  title: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  category: z.enum(INSPIRATION_CATEGORIES).default('OTHER'),
  tags: stringArray,
  brandId: cuid.optional().nullable(),
  campaignId: cuid.optional().nullable(),
  scriptReferenceId: cuid.optional().nullable(),
});
export type InspirationCreateInput = z.infer<typeof inspirationCreateSchema>;

export const inspirationUpdateSchema = z.object({
  title: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  category: z.enum(INSPIRATION_CATEGORIES).optional(),
  tags: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  brandId: cuid.optional().nullable(),
  campaignId: cuid.optional().nullable(),
  scriptReferenceId: cuid.optional().nullable(),
  status: z.enum(INSPIRATION_STATUSES).optional(),
  pinned: z.boolean().optional(),
});
export type InspirationUpdateInput = z.infer<typeof inspirationUpdateSchema>;

export const inspirationFilterSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  brandId: cuid.optional(),
  campaignId: cuid.optional(),
  category: z.enum(INSPIRATION_CATEGORIES).optional(),
  status: z.enum(INSPIRATION_STATUSES).optional(),
  pinned: z.coerce.boolean().optional(),
  search: z.string().trim().max(200).optional(),
});
export type InspirationFilter = z.infer<typeof inspirationFilterSchema>;

// --- Duplicate detection -----------------------------------------------------
/** Checked while adding/importing an influencer (PART 45-47) — never runs a merge, only surfaces candidates. */
export const duplicateCheckSchema = z.object({
  displayName: z.string().trim().max(200).optional(),
  platform: platformEnum.optional(),
  username: z.string().trim().max(120).optional(),
  email: z.string().trim().max(200).optional(),
  mobile: z.string().trim().max(60).optional(),
  whatsapp: z.string().trim().max(60).optional(),
  /** Exclude this influencer from its own duplicate check (editing an existing profile). */
  excludeInfluencerId: cuid.optional(),
});
export type DuplicateCheckInput = z.infer<typeof duplicateCheckSchema>;

// --- Bulk influencer-directory operations (PART 52-54) -----------------------
const bulkInfluencerIds = z.array(cuid).min(1).max(500);
export const bulkInfluencerRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ASSIGN_OWNER'), influencerIds: bulkInfluencerIds, ownerId: cuid }),
  z.object({ action: z.literal('ADD_TAG'), influencerIds: bulkInfluencerIds, tagName: z.string().trim().min(1).max(60) }),
  z.object({ action: z.literal('SET_RELATIONSHIP_STATUS'), influencerIds: bulkInfluencerIds, status: z.enum(RELATIONSHIP_STATUSES) }),
]);
export type BulkInfluencerRequest = z.infer<typeof bulkInfluencerRequestSchema>;

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

/** The searchable entity types a full search page can be narrowed to (W3-6). */
export const SEARCH_RESULT_TYPES = ['influencer', 'campaign', 'brand', 'published_content'] as const;
/** Full, ranked, paginated global search (W3-6). */
export const searchPageSchema = z.object({
  q: z.string().trim().min(1).max(200),
  brandId: cuid.optional(),
  // Accept ?types=influencer, ?types=a,b or repeated ?types=a&types=b.
  types: z
    .preprocess(
      (v) =>
        v == null
          ? undefined
          : Array.isArray(v)
            ? v
            : String(v)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
      z.array(z.enum(SEARCH_RESULT_TYPES)).max(4),
    )
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchPageQuery = z.infer<typeof searchPageSchema>;

// --- Creator performance leaderboard (W6-2) --------------------------------
export const leaderboardQuerySchema = z.object({
  brandId: cuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

// --- Executive dashboard (W6-3) --------------------------------------------
export const execDashboardQuerySchema = z.object({
  /** Narrow the whole overview to a single brand (must be in the caller's scope). */
  brandId: cuid.optional(),
});
export type ExecDashboardQuery = z.infer<typeof execDashboardQuerySchema>;

// --- Saved views / segments (W3-6) -----------------------------------------
const viewFilters = z.record(z.string(), z.any());
export const savedViewCreateSchema = z.object({
  scope: z.string().trim().min(1).max(60),
  name: shortString,
  filters: viewFilters.default({}),
  isShared: z.boolean().optional().default(false),
});
export const savedViewUpdateSchema = z.object({
  name: shortString.optional(),
  filters: viewFilters.optional(),
  isShared: z.boolean().optional(),
});
export const savedViewFilterSchema = z.object({ scope: z.string().trim().min(1).max(60).optional() });
export type SavedViewCreateInput = z.infer<typeof savedViewCreateSchema>;
export type SavedViewUpdateInput = z.infer<typeof savedViewUpdateSchema>;

// --- Integration settings --------------------------------------------------
export const integrationUpdateSchema = z.object({
  isEnabled: z.boolean().optional(),
  monitoringEnabled: z.boolean().optional(),
  // This endpoint toggles switches only. Credentials default to the server
  // environment; an admin may optionally store them encrypted via the dedicated
  // credential endpoints below (INT-4, providerCredentialSetSchema).
});

/** INT-4 — set/rotate one provider API credential (sealed before storage). */
export const providerCredentialSetSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string().min(1).max(4096),
});
export type ProviderCredentialSetInput = z.infer<typeof providerCredentialSetSchema>;

// --- Feature flags / client config (admin) --------------------------------
export const featureFlagUpdateSchema = z.object({
  enabled: z.boolean(),
});
export const clientConfigUpdateSchema = z.object({
  maintenanceMode: z.boolean().optional(),
  maintenanceMessage: optionalString,
  defaultLanguage: z.enum(['en', 'ar']).optional(),
  supportedLanguages: z.array(z.enum(['en', 'ar'])).optional(),
  // NOTE: the upload limit is NOT settable here — it is a single source of
  // truth, the MAX_UPLOAD_MB environment variable, which the API actually
  // enforces (W4-2). A DB value here would be decorative and misleading.
  supportInfo: optionalString,
});
export const appVersionUpdateSchema = z.object({
  recommendedVersion: optionalString,
  minimumVersion: optionalString,
  storeUrl: safeUrl,
  forceUpdate: z.boolean().optional(),
  maintenanceMessage: optionalString,
});

export { z };
