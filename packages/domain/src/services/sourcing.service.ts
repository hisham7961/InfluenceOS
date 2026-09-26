import {
  requests,
  type CampaignCandidateDTO,
  type CandidateDecision,
  type CandidateStatus,
  type CandidateSuggestionsDTO,
  type InfluencerSummaryDTO,
  type Platform,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireAnyCapability, requireCapability } from '../lib/authz';
import { iso, logActivity } from '../lib/helpers';
import { toInfluencerSummary } from '../lib/mappers';
import { isCountryOutOfScope, scopedBrandIds, scopedCountryCodes } from '../lib/scope';
import { AUDIENCE_MIN_PCT, ENGAGEMENT_GOOD, scoreSuggestion } from '../lib/suggestions';
import { makeCampaignInfluencerService } from './campaign-influencer.service';
import { makeCampaignService } from './campaign.service';

type CandidateCreate = z.infer<typeof requests.candidateCreateSchema>;
type CandidateUpdate = z.infer<typeof requests.candidateUpdateSchema>;
type CandidateDecisionInput = z.infer<typeof requests.candidateDecisionSchema>;
type CandidateConvert = z.infer<typeof requests.candidateConvertSchema>;
type SuggestQuery = z.infer<typeof requests.candidateSuggestQuerySchema>;

const candidateInclude = {
  influencer: {
    include: {
      socialAccounts: { select: { platform: true, followers: true, isPrimary: true, avatarUrl: true } },
      tags: { include: { tag: { select: { name: true } } } },
    },
  },
  addedBy: { select: { name: true } },
  decidedBy: { select: { name: true } },
} satisfies Prisma.CampaignCandidateInclude;

type Row = Prisma.CampaignCandidateGetPayload<{ include: typeof candidateInclude }>;

// A decision maps to the candidate's next sourcing stage. Nothing here creates a
// roster row or touches relationship history (DB-10) — only `convert` does.
const DECISION_STATUS: Record<CandidateDecision, CandidateStatus> = {
  SHORTLIST: 'SHORTLISTED',
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  RECONSIDER: 'CONSIDERING',
};

function toDTO(c: Row): CampaignCandidateDTO {
  return {
    id: c.id,
    campaignId: c.campaignId,
    influencer: toInfluencerSummary(c.influencer) as InfluencerSummaryDTO,
    status: c.status,
    fitScore: c.fitScore,
    notes: c.notes,
    decisionReason: c.decisionReason,
    addedByName: c.addedBy?.name ?? null,
    decidedByName: c.decidedBy?.name ?? null,
    decidedAt: iso(c.decidedAt),
    convertedCampaignInfluencerId: c.convertedCampaignInfluencerId,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/**
 * Sourcing / shortlist pipeline (W3-3). Creators are considered, shortlisted,
 * approved or rejected for a campaign BEFORE any roster commit, so staff can
 * evaluate a large pool without inflating anyone's collaboration history. Only
 * `convert` commits an approved/shortlisted candidate to the roster — and it
 * does so through the roster service, which keeps the DB-10-safe relationship
 * accounting (a freshly-added, still-INVITED participation counts as zero
 * collaborations until it is confirmed).
 */
export function makeSourcingService(ctx: DomainContext) {
  const { prisma } = ctx;

  // Security & Authorization Freeze Gate, section 10 — a child resource
  // (a sourcing candidate) must not be reachable once its parent Campaign is
  // out of the actor's brand scope, even though this file's own queries only
  // ever filtered by campaignId/candidateId. Delegates to the shared,
  // brand-scope-checked lookup every other campaign-child service reuses,
  // instead of a raw, unchecked `prisma.campaign.findUnique`.
  async function campaignOrThrow(campaignId: string) {
    return makeCampaignService(ctx).assertInScope(campaignId);
  }

  async function listForCampaign(campaignId: string, status?: CandidateStatus): Promise<CampaignCandidateDTO[]> {
    await campaignOrThrow(campaignId);
    const rows = await prisma.campaignCandidate.findMany({
      where: { campaignId, ...(status ? { status } : {}) },
      orderBy: [{ fitScore: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
      include: candidateInclude,
    });
    return rows.map(toDTO);
  }

  async function get(id: string): Promise<CampaignCandidateDTO> {
    const row = await prisma.campaignCandidate.findUnique({ where: { id }, include: candidateInclude });
    if (!row) throw AppError.notFound('Candidate');
    // Direct-ID brand scope — a scoped actor must not read an out-of-scope
    // campaign's candidate merely by guessing/knowing its id.
    await campaignOrThrow(row.campaignId);
    return toDTO(row);
  }

  async function add(campaignId: string, input: CandidateCreate): Promise<CampaignCandidateDTO> {
    // Capability grants WHAT; scope grants WHERE — both required. This was
    // previously bare requireActor(ctx), meaning ANY authenticated user could
    // add a sourcing candidate to any campaign regardless of brand access,
    // mirroring the exact gap campaign-influencer.service.ts's roster add had.
    const actor = await requireAnyCapability(ctx, ['CAMPAIGNS_MANAGE', 'INFLUENCERS_MANAGE']);
    const campaign = await campaignOrThrow(campaignId);
    const influencer = await prisma.influencer.findUnique({
      where: { id: input.influencerId },
      select: { id: true, displayName: true, countryCode: true },
    });
    if (!influencer) throw AppError.notFound('Influencer');
    // Same rule as the roster: an in-scope campaign never opens up a creator
    // outside the actor's countries.
    if (isCountryOutOfScope(await scopedCountryCodes(ctx), influencer.countryCode)) {
      throw AppError.notFound('Influencer');
    }

    const dup = await prisma.campaignCandidate.findUnique({
      where: { campaignId_influencerId: { campaignId, influencerId: input.influencerId } },
    });
    if (dup) throw AppError.conflict(`${influencer.displayName} is already a candidate on this campaign.`);

    const row = await prisma.campaignCandidate.create({
      data: {
        campaignId,
        influencerId: input.influencerId,
        status: 'CONSIDERING',
        fitScore: input.fitScore ?? null,
        notes: input.notes ?? null,
        addedById: actor.id,
      },
      include: candidateInclude,
    });
    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} added ${influencer.displayName} as a candidate for ${campaign.name}.`,
      brandId: campaign.brandId,
      campaignId,
      influencerId: influencer.id,
      meta: { candidateId: row.id },
    });
    return toDTO(row);
  }

  async function update(id: string, input: CandidateUpdate): Promise<CampaignCandidateDTO> {
    await requireAnyCapability(ctx, ['CAMPAIGNS_MANAGE', 'INFLUENCERS_MANAGE']);
    const existing = await prisma.campaignCandidate.findUnique({ where: { id }, select: { id: true, campaignId: true } });
    if (!existing) throw AppError.notFound('Candidate');
    await campaignOrThrow(existing.campaignId);
    const row = await prisma.campaignCandidate.update({
      where: { id },
      data: {
        fitScore: input.fitScore === undefined ? undefined : (input.fitScore ?? null),
        notes: input.notes === undefined ? undefined : (input.notes ?? null),
      },
      include: candidateInclude,
    });
    return toDTO(row);
  }

  async function decide(id: string, input: CandidateDecisionInput): Promise<CampaignCandidateDTO> {
    const actor = await requireAnyCapability(ctx, ['CAMPAIGNS_MANAGE', 'INFLUENCERS_MANAGE']);
    const existing = await prisma.campaignCandidate.findUnique({
      where: { id },
      include: { influencer: { select: { displayName: true } } },
    });
    if (!existing) throw AppError.notFound('Candidate');
    if (existing.status === 'CONVERTED') {
      throw AppError.badRequest('This candidate has already been committed to the roster.');
    }
    const campaign = await campaignOrThrow(existing.campaignId);
    const nextStatus = DECISION_STATUS[input.decision];
    const row = await prisma.campaignCandidate.update({
      where: { id },
      data: {
        status: nextStatus,
        decisionReason: input.reason ?? null,
        decidedById: actor.id,
        decidedAt: new Date(),
      },
      include: candidateInclude,
    });
    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} ${nextStatus.toLowerCase()} candidate ${existing.influencer.displayName} on ${campaign.name}.`,
      brandId: campaign.brandId,
      campaignId: existing.campaignId,
      influencerId: existing.influencerId,
      meta: { candidateId: id, decision: input.decision },
    });
    return toDTO(row);
  }

  /**
   * Commit an approved/shortlisted candidate to the campaign roster. Delegates
   * to the roster service so relationship accounting stays DB-10-safe, then
   * marks the candidate CONVERTED and links the created roster row.
   */
  async function convert(id: string, input: CandidateConvert): Promise<CampaignCandidateDTO> {
    const actor = await requireAnyCapability(ctx, ['CAMPAIGNS_MANAGE', 'INFLUENCERS_MANAGE']);
    const existing = await prisma.campaignCandidate.findUnique({
      where: { id },
      select: { id: true, campaignId: true, influencerId: true, status: true },
    });
    if (!existing) throw AppError.notFound('Candidate');
    // roster.add() below independently re-checks scope on this same
    // campaignId, but failing fast here keeps convert()'s own error surface
    // consistent with every other candidate mutation in this file.
    await campaignOrThrow(existing.campaignId);
    if (existing.status === 'CONVERTED') {
      throw AppError.badRequest('This candidate has already been committed to the roster.');
    }
    if (existing.status !== 'APPROVED' && existing.status !== 'SHORTLISTED') {
      throw AppError.badRequest('Only an approved or shortlisted candidate can be committed to the roster.');
    }

    // The roster service enforces the duplicate-on-roster guard and all
    // DB-10-safe relationship syncing. Payment status follows the deal type,
    // mirroring the roster service's own default.
    const dealType = input.dealType ?? 'PAID';
    const paymentStatus =
      dealType === 'FREE' || dealType === 'GIFTED_PRODUCT' ? 'NOT_APPLICABLE' : 'UNPAID';
    const roster = makeCampaignInfluencerService(ctx);
    const ci = await roster.add({
      campaignId: existing.campaignId,
      influencerId: existing.influencerId,
      dealType,
      agreedCost: input.agreedCost ?? null,
      currency: input.currency ?? null,
      giftedProductValue: input.giftedProductValue ?? null,
      dateContacted: null,
      expectedPublishAt: input.expectedPublishAt ?? null,
      participationStatus: 'INVITED',
      paymentStatus,
      paidAmount: null,
      paidAt: null,
      notes: null,
    });

    const row = await prisma.campaignCandidate.update({
      where: { id },
      data: {
        status: 'CONVERTED',
        convertedCampaignInfluencerId: ci.id,
        decidedById: actor.id,
        decidedAt: new Date(),
      },
      include: candidateInclude,
    });
    return toDTO(row);
  }

  async function remove(id: string): Promise<void> {
    await requireAnyCapability(ctx, ['CAMPAIGNS_MANAGE', 'INFLUENCERS_MANAGE']);
    const existing = await prisma.campaignCandidate.findUnique({ where: { id }, select: { id: true, campaignId: true } });
    if (!existing) throw AppError.notFound('Candidate');
    await campaignOrThrow(existing.campaignId);
    await prisma.campaignCandidate.delete({ where: { id } });
  }

  /**
   * Suggested creators (P3.7): in-scope, active creators not already on the
   * roster or the sourcing list who match at least one rule — audience in the
   * campaign's countries (their newest audience insights), based there,
   * worked with the brand before, or a good engagement rate — ranked by the
   * match score (scoreSuggestion), then by size.
   */
  async function suggestions(campaignId: string, query: SuggestQuery): Promise<CandidateSuggestionsDTO> {
    await requireCapability(ctx, 'INFLUENCERS_VIEW');
    await campaignOrThrow(campaignId);
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: {
        brandId: true,
        marketCountryCodes: true,
        campaignInfluencers: { select: { influencerId: true, deliverables: { select: { platform: true } } } },
        candidates: { select: { influencerId: true } },
      },
    });
    const markets = campaign.marketCountryCodes;
    const platforms = [
      ...new Set(campaign.campaignInfluencers.flatMap((ci) => ci.deliverables.map((d) => d.platform))),
    ].filter((p): p is Platform => Boolean(p));
    const taken = [
      ...campaign.campaignInfluencers.map((ci) => ci.influencerId),
      ...campaign.candidates.map((c) => c.influencerId),
    ];
    const [countryScope, brandScope] = await Promise.all([scopedCountryCodes(ctx), scopedBrandIds(ctx)]);

    const signals: Prisma.InfluencerWhereInput[] = [
      { brandInfluencers: { some: { brandId: campaign.brandId, totalCollaborations: { gt: 0 } } } },
      { socialAccounts: { some: { engagementRate: { gte: ENGAGEMENT_GOOD } } } },
    ];
    if (markets.length > 0) {
      signals.push({ countryCode: { in: markets } });
      signals.push({
        socialAccounts: {
          some: {
            audience: {
              some: { isLatest: true, countries: { some: { countryCode: { in: markets }, pct: { gte: AUDIENCE_MIN_PCT } } } },
            },
          },
        },
      });
    }
    const rows = await prisma.influencer.findMany({
      where: {
        isActive: true,
        relationshipStatus: { not: 'BLACKLISTED' },
        ...(taken.length ? { id: { notIn: taken } } : {}),
        // Not someone this brand has ruled out.
        NOT: { brandInfluencers: { some: { brandId: campaign.brandId, relationshipStatus: { in: ['BLACKLISTED', 'DECLINED'] } } } },
        ...(countryScope ? { countryCode: { in: countryScope } } : {}),
        ...(brandScope ? { brandInfluencers: { some: { brandId: { in: brandScope } } } } : {}),
        OR: signals,
      },
      include: {
        socialAccounts: {
          select: {
            platform: true,
            followers: true,
            isPrimary: true,
            avatarUrl: true,
            engagementRate: true,
            audience: {
              where: { isLatest: true },
              select: {
                countries: {
                  where: { countryCode: { in: markets } },
                  select: { countryCode: true, pct: true },
                },
              },
            },
          },
        },
        tags: { include: { tag: { select: { name: true } } } },
        brandInfluencers: { where: { brandId: campaign.brandId }, select: { totalCollaborations: true } },
      },
      orderBy: { updatedAt: 'desc' },
      // Enough to rank from; the rules above already narrow the pool.
      take: 1000,
    });

    const ranked = rows
      .map((row) => {
        const { score, reasons } = scoreSuggestion(
          {
            countryCode: row.countryCode,
            accounts: row.socialAccounts.map((a) => ({
              platform: a.platform,
              engagementRate: a.engagementRate,
              marketShares: a.audience.flatMap((i) => i.countries),
            })),
            collaborationsWithBrand: row.brandInfluencers[0]?.totalCollaborations ?? 0,
          },
          { markets, platforms },
        );
        const followers = row.socialAccounts.reduce((n, a) => n + (a.followers ?? 0), 0);
        return { row, score, reasons, followers };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.followers - a.followers)
      .slice(0, query.limit);

    return {
      markets,
      platforms,
      suggestions: ranked.map((r) => ({
        influencer: toInfluencerSummary(r.row) as InfluencerSummaryDTO,
        score: r.score,
        reasons: r.reasons,
      })),
    };
  }

  return { listForCampaign, get, add, update, decide, convert, remove, suggestions };
}

export type SourcingService = ReturnType<typeof makeSourcingService>;
