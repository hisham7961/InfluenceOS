/**
 * Centralized, localized enum → display-label resolution (Arabic
 * Localization pass). Every enum's canonical label set lives in
 * messages/{locale}/enums.json under a matching namespace key (e.g.
 * `enums.campaignStatus.DRAFT`) — this is the ONE place a component turns a
 * raw enum value into user-facing text. Never hardcode a switch/ternary
 * mapping an enum to a label in a component; never import the English-only
 * `*_LABELS` maps from `@influenceos/shared` for display text (those remain
 * for non-UI uses — CSV export headers, etc. — and as the source `en.json`
 * was seeded from, not a rendering path).
 *
 * Usage:
 *   Client component: const t = useTranslations('enums'); enumLabel(t, 'campaignStatus', status)
 *   Server component: const t = await getTranslations('enums'); enumLabel(t, 'campaignStatus', status)
 */

// The exact family keys under messages/{locale}/enums.json — keep in sync
// with that file (the translation parity check also validates the JSON
// itself, but this list is what gives callers compile-time key safety).
export type EnumFamily =
  | 'relationshipStatus'
  | 'dealType'
  | 'campaignStatus'
  | 'campaignObjective'
  | 'participationStatus'
  | 'deliverableType'
  | 'deliverableStatus'
  | 'submissionStatus'
  | 'scriptVersionStatus'
  | 'usageRightType'
  | 'usageRightStatus'
  | 'usageRightEffectiveStatus'
  | 'candidateStatus'
  | 'shipmentStatus'
  | 'contentStatus'
  | 'paymentStatus'
  | 'paymentMethod'
  | 'expenseType'
  | 'priority'
  | 'contactMethod'
  | 'audienceHealth'
  | 'creatorGender'
  | 'audienceSource'
  | 'dataSource'
  | 'inspirationCategory'
  | 'roleProfile'
  | 'capability'
  | 'logisticsIssueType'
  | 'logisticsIssueStatus'
  | 'addressHealth'
  | 'contentReviewStatus'
  | 'contentAssociationStatus'
  | 'integrationStatus';

/** A next-intl translator (from either useTranslations('enums') or getTranslations('enums')). */
type EnumTranslator = (key: string) => string;

/**
 * Resolve one enum value's localized label. `value` is typed as `string` (not
 * generic per-family) because callers pass the exact union type already
 * enforced by `@influenceos/shared`'s own enum types — this function only
 * adds the translation lookup, not the enum-value validation.
 */
export function enumLabel(t: EnumTranslator, family: EnumFamily, value: string): string {
  return t(`${family}.${value}`);
}
