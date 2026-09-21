import {
  type DataQualityFindingDTO,
  type DataQualityReportDTO,
  type DataQualitySeverity,
  type DuplicateCandidateDTO,
  type DuplicateMatchConfidence,
} from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { requireActor } from '../lib/authz';
import { scopedBrandIds } from '../lib/scope';

// A deal only owes real money when dealType implies payment — FREE and
// GIFTED_PRODUCT collaborations legitimately have no agreedCost, so a null
// there is never a finding (money.ts's "missing is never coerced" philosophy
// applies to findings too: don't flag what's expected to be absent).
const PAID_DEAL_TYPES = ['PAID', 'PAID_PLUS_GIFTED'] as const;
const OPEN_CAMPAIGN_STATUSES = ['PLANNING', 'ACTIVE', 'PAUSED'] as const;
const ACTIVE_DELIVERABLE_STATUSES = ['PLANNED', 'SENT_TO_INFLUENCER', 'AWAITING_PUBLICATION', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'] as const;
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

  async function report(brandId?: string): Promise<DataQualityReportDTO> {
    requireActor(ctx);
    const brandIds = await effectiveBrandIds(brandId);
    const influencerBrandWhere = brandIds ? { brandInfluencers: { some: { brandId: { in: brandIds } } } } : {};
    const campaignBrandWhere = brandIds ? { brandId: { in: brandIds } } : {};
    const shipmentBrandWhere = brandIds ? { campaignInfluencer: { campaign: { brandId: { in: brandIds } } } } : {};
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
    ] = await Promise.all([
      prisma.influencer.count({ where: { ...influencerBrandWhere, socialAccounts: { none: {} } } }),
      prisma.influencer.count({ where: { ...influencerBrandWhere, email: null, mobile: null, whatsapp: null } }),
      prisma.influencer.count({ where: { ...influencerBrandWhere, category: null } }),
      prisma.campaign.count({ where: { ...campaignBrandWhere, status: { in: [...OPEN_CAMPAIGN_STATUSES] }, plannedBudget: null } }),
      prisma.campaignInfluencer.count({
        where: { campaign: campaignBrandWhere, dealType: { in: [...PAID_DEAL_TYPES] }, agreedCost: null },
      }),
      prisma.deliverable.count({
        where: { campaignInfluencer: { campaign: campaignBrandWhere }, status: { in: [...ACTIVE_DELIVERABLE_STATUSES] }, dueDate: null },
      }),
      // 1. Missing canonical country — split by relationship engagement (see
      // ENGAGED_RELATIONSHIP_STATUSES doc comment for the severity rule).
      prisma.influencer.count({ where: { ...influencerBrandWhere, countryCode: null, ...engagedWhere } }),
      prisma.influencer.count({ where: { ...influencerBrandWhere, countryCode: null, ...prospectWhere } }),
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
      prisma.productShipment.count({
        where: { ...shipmentBrandWhere, status: { in: [...ACTIVE_SHIPMENT_STATUSES] }, destinationCountryCode: null },
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
    ];

    return { findings, generatedAt: new Date().toISOString() };
  }

  async function duplicates(brandId?: string): Promise<DuplicateCandidateDTO[]> {
    requireActor(ctx);
    const brandIds = await effectiveBrandIds(brandId);
    const where = brandIds ? { brandInfluencers: { some: { brandId: { in: brandIds } } } } : {};

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
      const hasHardMatch = reasons.some((r) => HARD_IDENTIFIER_FIELDS.has(r.field));
      let confidence: DuplicateMatchConfidence;
      if (hasHardMatch) {
        confidence = 'exact';
      } else {
        const nameReason = reasons.find((r) => r.field === 'name');
        const wordCount = nameReason ? nameReason.value.trim().split(/\s+/).length : 0;
        confidence = wordCount >= 2 ? 'strongPossible' : 'possible';
      }
      const primaryAccount = inf.socialAccounts.find((a) => a.isPrimary) ?? inf.socialAccounts[0] ?? null;
      const avatarUrl = inf.avatarOverrideUrl ?? inf.resolvedAvatarUrl ?? primaryAccount?.avatarUrl ?? null;
      candidates.push({ influencerId: id, displayName: inf.displayName, avatarUrl, confidence, reasons });
    }

    // Sort so members of the same cluster land next to each other — the
    // lowest matched value across an entry's reasons doubles as a stable
    // cluster key without needing a separate groupId field in the DTO.
    const clusterKey = (c: DuplicateCandidateDTO) => c.reasons.map((r) => r.value.toLowerCase()).sort()[0] ?? c.displayName;
    candidates.sort((a, b) => clusterKey(a).localeCompare(clusterKey(b)) || a.displayName.localeCompare(b.displayName));

    return candidates;
  }

  return { report, duplicates };
}

export type DataQualityService = ReturnType<typeof makeDataQualityService>;
