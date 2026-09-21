import {
  requests,
  type CampaignCandidateDTO,
  type CandidateDecision,
  type CandidateStatus,
  type InfluencerSummaryDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireAnyCapability } from '../lib/authz';
import { iso, logActivity } from '../lib/helpers';
import { toInfluencerSummary } from '../lib/mappers';
import { makeCampaignInfluencerService } from './campaign-influencer.service';
import { makeCampaignService } from './campaign.service';

type CandidateCreate = z.infer<typeof requests.candidateCreateSchema>;
type CandidateUpdate = z.infer<typeof requests.candidateUpdateSchema>;
type CandidateDecisionInput = z.infer<typeof requests.candidateDecisionSchema>;
type CandidateConvert = z.infer<typeof requests.candidateConvertSchema>;

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
      select: { id: true, displayName: true },
    });
    if (!influencer) throw AppError.notFound('Influencer');

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

  return { listForCampaign, get, add, update, decide, convert, remove };
}

export type SourcingService = ReturnType<typeof makeSourcingService>;
