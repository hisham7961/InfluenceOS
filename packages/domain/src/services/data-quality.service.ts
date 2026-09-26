import {
  requests,
  type DataQualityFindingDTO,
  type DataQualityReportDTO,
  type DataQualitySeverity,
  type DuplicateCandidateDTO,
  type DuplicateMatchConfidence,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { requireActor } from '../lib/authz';
import { outstandingWhere } from '../lib/deliverable-rules';
import { scopedBrandIds, scopedCountryCodes } from '../lib/scope';

// Matches the established z.infer<typeof requests.xSchema> pattern the rest
// of the domain package uses for its request-input types (duplicateCheckSchema
// is not individually re-exported from the contracts barrel, only via the
// `requests` namespace).
type DuplicateCheckInput = z.infer<typeof requests.duplicateCheckSchema>;

// A deal only owes real money when dealType implies payment — FREE and
// GIFTED_PRODUCT collaborations legitimately have no agreedCost, so a null
// there is never a finding (money.ts's "missing is never coerced" philosophy
// applies to findings too: don't flag what's expected to be absent).
const PAID_DEAL_TYPES = ['PAID', 'PAID_PLUS_GIFTED'] as const;
const OPEN_CAMPAIGN_STATUSES = ['PLANNING', 'ACTIVE', 'PAUSED'] as const;
// "Campaign missing an owner" mirrors the canonical status set
// dashboard.service.ts::attention() uses for its 'campaigns-missing-owner'
// item (ownerlessCount) exactly — kept in sync by this cross-reference
// comment rather than a shared import, matching this file's existing
// per-check local constants (OPEN_CAMPAIGN_STATUSES above differs on
// purpose: this one is the narrower "worth chasing an owner for" set).
const OWNER_RELEVANT_CAMPAIGN_STATUSES = ['ACTIVE', 'PLANNING'] as const;

// Severity-tiering rule for creator-profile completeness checks (country,
// owner, mobile number): RelationshipStatus splits into an "engaged" bucket
// — a relationship that is actually in motion, where missing data blocks
// real work — and the PROSPECT bucket, an early-pipeline creator nobody has
// worked with yet, where the same gap is expected and not yet actionable.
// PAST/DECLINED/BLACKLISTED creators are deliberately excluded from BOTH
// findings below (same "don't flag what's expected to be absent" philosophy
// as the PAID_DEAL_TYPES comment above) — the relationship is over, so
// nobody is going to go back and complete their profile.
const ENGAGED_RELATIONSHIP_STATUSES = ['CONTACTED', 'NEGOTIATING', 'ACTIVE', 'RECURRING'] as const;

// "Active" shipment — not yet DELIVERED/FAILED/RETURNED — mirrors
// shipment.service.ts's ACTIVE_SHIPMENT_STATUSES exactly (the buildWhere()
// `missingAddress`/`missingPhone`/`missingDestinationCountry` filters these
// findings deep-link to), so a finding's count and its filtered destination
// never disagree.
const ACTIVE_SHIPMENT_STATUSES = ['PENDING', 'SHIPPED', 'IN_TRANSIT'] as const;

type Reason = DuplicateCandidateDTO['reasons'][number];
type ReasonField = Reason['field'];

const PLATFORM_REASON_FIELD: Record<string, ReasonField> = {
  INSTAGRAM: 'instagramUsername',
  TIKTOK: 'tiktokUsername',
  YOUTUBE: 'youtubeUsername',
  SNAPCHAT: 'snapchatUsername',
  X: 'xUsername',
};

const HARD_IDENTIFIER_FIELDS = new Set<ReasonField>([
  'instagramUsername',
  'tiktokUsername',
  'youtubeUsername',
  'snapchatUsername',
  'xUsername',
  'email',
  'mobile',
  'whatsapp',
]);

// A common first name shared by many unrelated creators is noise, not a
// duplicate signal — cap how large a name-only group can get before we stop
// treating it as meaningful. Hard identifiers (email/phone/handle) have no
// such cap: any group size sharing one of those is worth surfacing.
const MAX_NAME_GROUP = 5;

function mkFinding(
  id: string,
  title: string,
  severity: DataQualitySeverity,
  count: number,
  link: string,
  fixLabel: string | null = null,
): DataQualityFindingDTO {
  return { id, title, severity, count, link, fixLabel };
}

function normalizePhone(s: string): string {
  return s.replace(/\D/g, '');
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Shared by duplicates() and checkDuplicate() so a hard-identifier match is
 *  always 'exact' and a name-only match is 'strongPossible'/'possible' by the
 *  same word-count split, no matter which entry point computed the reasons. */
function confidenceFor(reasons: Reason[]): DuplicateMatchConfidence {
  const hasHardMatch = reasons.some((r) => HARD_IDENTIFIER_FIELDS.has(r.field));
  if (hasHardMatch) return 'exact';
  const nameReason = reasons.find((r) => r.field === 'name');
  const wordCount = nameReason ? nameReason.value.trim().split(/\s+/).length : 0;
  return wordCount >= 2 ? 'strongPossible' : 'possible';
}

interface CandidateAvatarInput {
  avatarOverrideUrl: string | null;
  resolvedAvatarUrl: string | null;
  socialAccounts: { avatarUrl: string | null; isPrimary: boolean }[];
}

function avatarFor(inf: CandidateAvatarInput): string | null {
  const primaryAccount = inf.socialAccounts.find((a) => a.isPrimary) ?? inf.socialAccounts[0] ?? null;
  return inf.avatarOverrideUrl ?? inf.resolvedAvatarUrl ?? primaryAccount?.avatarUrl ?? null;
}

interface KeyEntry {
  field: ReasonField;
  value: string;
  influencerIds: Set<string>;
}

/**
 * Data Quality + Duplicate Detection (Operations Intelligence pass, PART
 * 41-48) — findings are always aggregate COUNTS of real rows matching a real
 * condition (never a fabricated score), and duplicate candidates are shown
 * with the exact field/value that matched so a human can judge for
 * themselves — this never emits an opaque "these are duplicates" verdict.
 */
export function makeDataQualityService(ctx: DomainContext) {
  const { prisma } = ctx;

  /** Resolves the effective brand filter: an explicit brandId narrows within
   *  the caller's scope (never widens it — an out-of-scope brandId yields an
   *  impossible filter, matching nothing, rather than silently falling back
   *  to the caller's full scope). */
  async function effectiveBrandIds(brandId?: string): Promise<string[] | null> {
    const scope = await scopedBrandIds(ctx);
    if (!brandId) return scope;
    if (scope && !scope.includes(brandId)) return [];
    return [brandId];
  }

  // Security & Authorization Freeze Gate (aggregate-leak-audit, spec §49-55)
  // — country scope, composed alongside brand scope into every finding
  // below. This is the EXACT leak the spec calls out by name: a KW-only
  // country-scoped actor (UserCountryAccess rows for KW only, no
  // UserBrandAccess rows — so brand-unscoped) must never learn e.g. "27
  // Saudi creators missing phone" from these aggregate counts, even though
  // every individual SA creator record stays unreachable to them everywhere
  // else in the app.
  //
  // `influencerBrandWhere`/`shipmentBrandWhere` below fold BOTH brand and
  // country scope together for every finding EXCEPT the two "missing
  // canonical country" ones — those set `countryCode`/`destinationCountryCode`
  // to `null` themselves, and a flat object spread of `{ countryCode: { in:
  // [...] } }` followed by `countryCode: null` would silently overwrite (last
  // key wins) rather than AND, accidentally dropping the scope check exactly
  // where it matters most. Those two counts instead use `missingCountryFilter`
  // directly: per `isCountryOutOfScope` (lib/scope.ts), an uncategorized
  // record is ALWAYS out of scope for a country-scoped actor, so their count
  // for "creators/shipments with no canonical country" is correctly always 0
  // — `{ in: [] }` (matches nothing) rather than `null` (matches everything
  // uncategorized) once the actor is country-scoped.
  async function report(brandId?: string): Promise<DataQualityReportDTO> {
    requireActor(ctx);
    const brandIds = await effectiveBrandIds(brandId);
    const countryScope = await scopedCountryCodes(ctx);

    const influencerBrandOnlyWhere = brandIds ? { brandInfluencers: { some: { brandId: { in: brandIds } } } } : {};
    const influencerBrandWhere = {
      ...influencerBrandOnlyWhere,
      ...(countryScope ? { countryCode: { in: countryScope } } : {}),
    };
    const missingCountryFilter: { in: string[] } | null = countryScope ? { in: [] } : null;
    const campaignBrandWhere = brandIds ? { brandId: { in: brandIds } } : {};
    const shipmentBrandOnlyWhere = brandIds ? { campaignInfluencer: { campaign: { brandId: { in: brandIds } } } } : {};
    const shipmentBrandWhere = {
      ...shipmentBrandOnlyWhere,
      ...(countryScope ? { destinationCountryCode: { in: countryScope } } : {}),
    };
    const missingDestinationCountryFilter: { in: string[] } | null = countryScope ? { in: [] } : null;
    const contentBrandWhere = brandIds ? { brandId: { in: brandIds } } : {};

    const engagedWhere: Prisma.InfluencerWhereInput = { relationshipStatus: { in: [...ENGAGED_RELATIONSHIP_STATUSES] } };
    const prospectWhere: Prisma.InfluencerWhereInput = { relationshipStatus: 'PROSPECT' };

    const [
      noSocial,
      noContact,
      noCategory,
      campaignsNoBudget,
      paidNoCost,
      deliverablesNoDueDate,
      engagedNoCountry,
      prospectNoCountry,
      engagedNoOwner,
      prospectNoOwner,
      engagedNoMobile,
      prospectNoMobile,
      shipmentMissingAddress,
      shipmentMissingPhone,
      shipmentMissingCountry,
      campaignsNoOwner,
      contentUnassigned,
      contentNoMetrics,
    ] = await Promise.all([
      prisma.influencer.count({ where: { ...influencerBrandWhere, socialAccounts: { none: {} } } }),
      prisma.influencer.count({ where: { ...influencerBrandWhere, email: null, mobile: null, whatsapp: null } }),
      prisma.influencer.count({ where: { ...influencerBrandWhere, category: null } }),
      prisma.campaign.count({ where: { ...campaignBrandWhere, status: { in: [...OPEN_CAMPAIGN_STATUSES] }, plannedBudget: null } }),
      prisma.campaignInfluencer.count({
        where: { campaign: campaignBrandWhere, dealType: { in: [...PAID_DEAL_TYPES] }, agreedCost: null },
      }),
      prisma.deliverable.count({
        where: { AND: [outstandingWhere], campaignInfluencer: { campaign: campaignBrandWhere }, dueDate: null },
      }),
      // 1. Missing canonical country — split by relationship engagement (see
      // ENGAGED_RELATIONSHIP_STATUSES doc comment for the severity rule).
      // Uses influencerBrandOnlyWhere + missingCountryFilter (see the doc
      // comment above `report()`), never influencerBrandWhere directly — that
      // already carries `countryCode: { in: scope } }`, which a flat spread
      // next to a literal `countryCode: null` here would silently overwrite.
      prisma.influencer.count({ where: { ...influencerBrandOnlyWhere, countryCode: missingCountryFilter, ...engagedWhere } }),
      prisma.influencer.count({ where: { ...influencerBrandOnlyWhere, countryCode: missingCountryFilter, ...prospectWhere } }),
      // 2. Missing relationship owner — same engaged/prospect split.
      prisma.influencer.count({ where: { ...influencerBrandWhere, ownerId: null, ...engagedWhere } }),
      prisma.influencer.count({ where: { ...influencerBrandWhere, ownerId: null, ...prospectWhere } }),
      // 3. Missing phone (mobile) — "operationally relevant" means engaged
      // creators only get the needsAttention tier; a Prospect with no phone
      // yet is expected, never flagged as an error (incomplete tier).
      prisma.influencer.count({ where: { ...influencerBrandWhere, mobile: null, ...engagedWhere } }),
      prisma.influencer.count({ where: { ...influencerBrandWhere, mobile: null, ...prospectWhere } }),
      // 5. Active shipment (not yet DELIVERED/FAILED/RETURNED) missing its
      // own address/phone/destinationCountryCode snapshot field — mirrors
      // shipment.service.ts's missingAddress/missingPhone/
      // missingDestinationCountry buildWhere() filters exactly.
      prisma.productShipment.count({
        where: { ...shipmentBrandWhere, status: { in: [...ACTIVE_SHIPMENT_STATUSES] }, OR: [{ addressLine1: null }, { addressLine1: '' }] },
      }),
      prisma.productShipment.count({
        where: { ...shipmentBrandWhere, status: { in: [...ACTIVE_SHIPMENT_STATUSES] }, OR: [{ phone: null }, { phone: '' }] },
      }),
      // Same overwrite hazard as the influencer "missing country" checks
      // above — shipmentBrandOnlyWhere + missingDestinationCountryFilter,
      // never shipmentBrandWhere (which already sets destinationCountryCode
      // to the scope's `{ in }` filter).
      prisma.productShipment.count({
        where: {
          ...shipmentBrandOnlyWhere,
          status: { in: [...ACTIVE_SHIPMENT_STATUSES] },
          destinationCountryCode: missingDestinationCountryFilter,
        },
      }),
      // 6. Campaign missing an owner — the SAME condition
      // dashboard.service.ts::attention() already canonically computes as
      // 'campaigns-missing-owner' (ownerlessCount). Intentionally mirrored,
      // never a divergent definition (MUST NOT duplicate Needs Attention),
      // and linked to that item's exact destination.
      prisma.campaign.count({ where: { ...campaignBrandWhere, ownerId: null, status: { in: [...OWNER_RELEVANT_CAMPAIGN_STATUSES] } } }),
      // 8. PublishedContent unassigned — the SAME condition
      // dashboard.service.ts::attention() already canonically computes as
      // 'unassigned-content' (unassignedCount). Intentionally mirrored, never
      // a divergent definition, and linked to that item's exact (already
      // working) destination — /content?assignment=UNASSIGNED.
      prisma.publishedContent.count({ where: { ...contentBrandWhere, campaignId: null, influencerId: null } }),
      // 9. Live posts with no numbers after 3 days — mostly Snapchat, TikTok
      // and Stories, which have no metrics API and must be typed in. A stricter
      // cut of the wall's "No metrics" chip (that one counts every post still
      // up, from day one), linked to the same filtered wall.
      prisma.publishedContent.count({
        where: {
          ...contentBrandWhere,
          availabilityStatus: 'LIVE',
          detectedAt: { lt: new Date(Date.now() - 3 * 864e5) },
          metricSnapshots: { none: {} },
        },
      }),
    ]);

    // 4. Missing any social account already exists as 'influencer-no-social'
    // below — only its deep link changes (bare '/influencers' →
    // '/influencers?missingSocial=true').
    // 7. Missing due date already exists as 'deliverable-no-due-date' below,
    // unchanged.
    const findings: DataQualityFindingDTO[] = [
      mkFinding('influencer-no-social', 'Creators with no social accounts', 'critical', noSocial, '/influencers?missingSocial=true'),
      mkFinding('paid-deal-no-cost', 'Paid deals missing an agreed cost', 'critical', paidNoCost, '/campaigns'),
      mkFinding('influencer-no-contact', 'Creators with no email, mobile or WhatsApp on file', 'needsAttention', noContact, '/influencers'),
      mkFinding('campaign-no-budget', 'Active campaigns with no planned budget', 'needsAttention', campaignsNoBudget, '/campaigns'),
      mkFinding('deliverable-no-due-date', 'Active deliverables with no due date', 'incomplete', deliverablesNoDueDate, '/campaigns'),
      mkFinding('influencer-no-category', 'Creators with no category set', 'informational', noCategory, '/influencers'),

      mkFinding(
        'shipment-active-missing-address',
        'Active shipments with no delivery address',
        'critical',
        shipmentMissingAddress,
        '/logistics?missingAddress=true',
      ),
      mkFinding(
        'shipment-active-missing-country',
        'Active shipments with no destination country',
        'critical',
        shipmentMissingCountry,
        '/logistics?missingDestinationCountry=true',
      ),
      mkFinding(
        'shipment-active-missing-phone',
        'Active shipments with no phone number',
        'needsAttention',
        shipmentMissingPhone,
        '/logistics?missingPhone=true',
      ),

      mkFinding(
        'influencer-engaged-no-country',
        'Engaged creators missing a canonical country',
        'needsAttention',
        engagedNoCountry,
        '/influencers?missingCountry=true',
      ),
      mkFinding(
        'influencer-prospect-no-country',
        'Prospect creators missing a canonical country',
        'incomplete',
        prospectNoCountry,
        '/influencers?missingCountry=true&relationshipStatus=PROSPECT',
      ),
      mkFinding(
        'influencer-engaged-no-owner',
        'Engaged creators with no relationship owner',
        'needsAttention',
        engagedNoOwner,
        '/influencers?missingOwner=true',
        'Assign Owner',
      ),
      mkFinding(
        'influencer-prospect-no-owner',
        'Prospect creators with no relationship owner',
        'incomplete',
        prospectNoOwner,
        '/influencers?missingOwner=true&relationshipStatus=PROSPECT',
        'Assign Owner',
      ),
      mkFinding(
        'influencer-engaged-no-mobile',
        'Engaged creators with no mobile number on file',
        'needsAttention',
        engagedNoMobile,
        '/influencers?missingPhone=true',
      ),
      mkFinding(
        'influencer-prospect-no-mobile',
        'Prospect creators with no mobile number yet',
        'incomplete',
        prospectNoMobile,
        '/influencers?missingPhone=true&relationshipStatus=PROSPECT',
      ),

      // Mirrors dashboard.service.ts::attention() — see the comment on the
      // count query above. NOTE: '/campaigns?ownerMissing=1' is the exact
      // link that Needs Attention item already uses; campaign.service.ts's
      // buildWhere() does not currently implement it (a pre-existing gap
      // outside this check's scope — see final report).
      mkFinding('campaign-no-owner', 'Active or planning campaigns with no owner', 'needsAttention', campaignsNoOwner, '/campaigns?ownerMissing=1'),
      // Mirrors dashboard.service.ts::attention() — see the comment on the
      // count query above. This deep link is already fully wired
      // (content.service.ts's buildWhere() implements `assignment`).
      mkFinding(
        'content-unassigned',
        'Published content with no campaign or influencer linked',
        'needsAttention',
        contentUnassigned,
        '/content?assignment=UNASSIGNED',
      ),
      mkFinding(
        'content-no-metrics',
        'Live posts with no views or engagement entered after 3 days',
        'incomplete',
        contentNoMetrics,
        '/content?metrics=missing',
      ),
    ];

    return { findings, generatedAt: new Date().toISOString() };
  }

  async function duplicates(brandId?: string): Promise<DuplicateCandidateDTO[]> {
    requireActor(ctx);
    const brandIds = await effectiveBrandIds(brandId);
    const countryScope = await scopedCountryCodes(ctx);
    // Brand + country scope (same posture as report() above) — a duplicate
    // candidate's `reasons` carry REAL field values (an actual email/phone/
    // handle), so this bulk clustering report must never surface an
    // out-of-scope creator's identity just because they happen to share a
    // phone number with an in-scope one. checkDuplicate() below is the one
    // deliberate exception (see its own doc comment): a single-candidate,
    // no-field-values-of-others-leaked check run before creating a record.
    const where = {
      ...(brandIds ? { brandInfluencers: { some: { brandId: { in: brandIds } } } } : {}),
      ...(countryScope ? { countryCode: { in: countryScope } } : {}),
    };

    const influencers = await prisma.influencer.findMany({
      where,
      select: {
        id: true,
        displayName: true,
        avatarOverrideUrl: true,
        resolvedAvatarUrl: true,
        email: true,
        mobile: true,
        whatsapp: true,
        socialAccounts: { select: { platform: true, username: true, avatarUrl: true, isPrimary: true } },
      },
    });

    const keys = new Map<string, KeyEntry>();
    function addKey(field: ReasonField, rawValue: string, normalized: string, influencerId: string) {
      if (!normalized) return;
      const mapKey = `${field}:${normalized}`;
      let entry = keys.get(mapKey);
      if (!entry) {
        entry = { field, value: rawValue.trim(), influencerIds: new Set() };
        keys.set(mapKey, entry);
      }
      entry.influencerIds.add(influencerId);
    }

    for (const inf of influencers) {
      if (inf.email) addKey('email', inf.email, normalizeText(inf.email), inf.id);
      if (inf.mobile) addKey('mobile', inf.mobile, normalizePhone(inf.mobile), inf.id);
      if (inf.whatsapp) addKey('whatsapp', inf.whatsapp, normalizePhone(inf.whatsapp), inf.id);
      addKey('name', inf.displayName, normalizeText(inf.displayName), inf.id);
      for (const acc of inf.socialAccounts) {
        const field = PLATFORM_REASON_FIELD[acc.platform];
        if (field) addKey(field, acc.username, normalizeText(acc.username), inf.id);
      }
    }

    const perInfluencerReasons = new Map<string, Reason[]>();
    for (const entry of keys.values()) {
      if (entry.influencerIds.size < 2) continue;
      if (entry.field === 'name' && entry.influencerIds.size > MAX_NAME_GROUP) continue;
      for (const id of entry.influencerIds) {
        const list = perInfluencerReasons.get(id) ?? [];
        list.push({ field: entry.field, value: entry.value });
        perInfluencerReasons.set(id, list);
      }
    }

    const byId = new Map(influencers.map((i) => [i.id, i]));
    const candidates: DuplicateCandidateDTO[] = [];
    for (const [id, reasons] of perInfluencerReasons) {
      const inf = byId.get(id)!;
      const confidence = confidenceFor(reasons);
      candidates.push({ influencerId: id, displayName: inf.displayName, avatarUrl: avatarFor(inf), confidence, reasons });
    }

    // Sort so members of the same cluster land next to each other — the
    // lowest matched value across an entry's reasons doubles as a stable
    // cluster key without needing a separate groupId field in the DTO.
    const clusterKey = (c: DuplicateCandidateDTO) => c.reasons.map((r) => r.value.toLowerCase()).sort()[0] ?? c.displayName;
    candidates.sort((a, b) => clusterKey(a).localeCompare(clusterKey(b)) || a.displayName.localeCompare(b.displayName));

    return candidates;
  }

  /**
   * Live, single-candidate duplicate check (PART 45-47) — run before an
   * influencer is actually created (Add Influencer / import), never as a
   * post-hoc report. Deliberately NOT brand-scoped: the point is to catch
   * the same person already in the system under ANY brand, so a candidate
   * who already exists elsewhere still surfaces here.
   *
   * Reuses duplicates()'s exact normalizeText/normalizePhone/
   * HARD_IDENTIFIER_FIELDS/PLATFORM_REASON_FIELD/confidenceFor/avatarFor —
   * the matching RULES are identical, only how candidates are fetched
   * differs: narrow indexed WHERE clauses instead of the full-table scan
   * duplicates() needs to cluster everyone against everyone.
   */
  async function checkDuplicate(input: DuplicateCheckInput): Promise<DuplicateCandidateDTO[]> {
    requireActor(ctx);

    const displayName = input.displayName?.trim() || undefined;
    const username = input.username?.trim() || undefined;
    const email = input.email?.trim() || undefined;
    const mobile = input.mobile?.trim() || undefined;
    const whatsapp = input.whatsapp?.trim() || undefined;

    // What to key this one candidate on — same fields duplicates() clusters
    // on, just computed against a single incoming record instead of every
    // pairing in the table.
    const candidateKeys: { field: ReasonField; normalized: string }[] = [];
    if (email) candidateKeys.push({ field: 'email', normalized: normalizeText(email) });
    if (mobile) candidateKeys.push({ field: 'mobile', normalized: normalizePhone(mobile) });
    if (whatsapp) candidateKeys.push({ field: 'whatsapp', normalized: normalizePhone(whatsapp) });
    if (displayName) candidateKeys.push({ field: 'name', normalized: normalizeText(displayName) });
    if (username && input.platform) {
      const field = PLATFORM_REASON_FIELD[input.platform];
      if (field) candidateKeys.push({ field, normalized: normalizeText(username) });
    }
    if (candidateKeys.length === 0) return [];

    // Narrow, indexed WHERE clauses (equality on email/mobile/whatsapp, a
    // platform+username match, or a display-name substring search — the
    // same `contains`/`mode: 'insensitive'` pattern influencer.service.ts's
    // and search.service.ts's name lookups already use) instead of
    // duplicates()'s unbounded findMany — this runs on every keystroke-ish
    // form check, not once per report.
    const or: Prisma.InfluencerWhereInput[] = [];
    if (email) or.push({ email: { equals: email, mode: 'insensitive' } });
    if (mobile) or.push({ mobile });
    if (whatsapp) or.push({ whatsapp });
    if (username && input.platform) {
      or.push({ socialAccounts: { some: { platform: input.platform, username: { equals: username, mode: 'insensitive' } } } });
    }
    if (displayName) or.push({ displayName: { contains: displayName, mode: 'insensitive' } });

    const where: Prisma.InfluencerWhereInput = {
      OR: or,
      ...(input.excludeInfluencerId ? { id: { not: input.excludeInfluencerId } } : {}),
    };

    const influencers = await prisma.influencer.findMany({
      where,
      take: 25,
      select: {
        id: true,
        displayName: true,
        avatarOverrideUrl: true,
        resolvedAvatarUrl: true,
        email: true,
        mobile: true,
        whatsapp: true,
        socialAccounts: { select: { platform: true, username: true, avatarUrl: true, isPrimary: true } },
      },
    });

    const candidates: DuplicateCandidateDTO[] = [];
    for (const inf of influencers) {
      const reasons: Reason[] = [];
      for (const key of candidateKeys) {
        if (key.field === 'email') {
          if (inf.email && normalizeText(inf.email) === key.normalized) reasons.push({ field: 'email', value: inf.email.trim() });
        } else if (key.field === 'mobile') {
          if (inf.mobile && normalizePhone(inf.mobile) === key.normalized) reasons.push({ field: 'mobile', value: inf.mobile.trim() });
        } else if (key.field === 'whatsapp') {
          if (inf.whatsapp && normalizePhone(inf.whatsapp) === key.normalized) reasons.push({ field: 'whatsapp', value: inf.whatsapp.trim() });
        } else if (key.field === 'name') {
          if (normalizeText(inf.displayName) === key.normalized) reasons.push({ field: 'name', value: inf.displayName.trim() });
        } else {
          const acc = inf.socialAccounts.find((a) => PLATFORM_REASON_FIELD[a.platform] === key.field && normalizeText(a.username) === key.normalized);
          if (acc) reasons.push({ field: key.field, value: acc.username.trim() });
        }
      }
      if (reasons.length === 0) continue; // WHERE can widen the net (e.g. displayName `contains`) beyond what actually normalizes equal
      candidates.push({ influencerId: inf.id, displayName: inf.displayName, avatarUrl: avatarFor(inf), confidence: confidenceFor(reasons), reasons });
    }

    const CONFIDENCE_RANK: Record<DuplicateMatchConfidence, number> = { exact: 0, strongPossible: 1, possible: 2 };
    candidates.sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] || a.displayName.localeCompare(b.displayName));
    return candidates;
  }

  return { report, duplicates, checkDuplicate };
}

export type DataQualityService = ReturnType<typeof makeDataQualityService>;
