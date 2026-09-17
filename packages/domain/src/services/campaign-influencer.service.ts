import {
  requests,
  type CampaignInfluencerDTO,
  type InfluencerSummaryDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { iso, logActivity } from '../lib/helpers';
import { toMoneyNumber, type MoneyInput } from '../lib/money';
import { toInfluencerSummary } from '../lib/mappers';
import { toDeliverableDTO } from './deliverable.service';

type CIAdd = z.infer<typeof requests.campaignInfluencerCreateSchema>;
type CIUpdate = z.infer<typeof requests.campaignInfluencerUpdateSchema>;

const influencerSummaryInclude = {
  socialAccounts: {
    select: { platform: true, followers: true, isPrimary: true, avatarUrl: true },
  },
  tags: { include: { tag: { select: { name: true } } } },
} satisfies Prisma.InfluencerInclude;

const PUBLISHED = ['PUBLISHED', 'VERIFIED'] as const;

// A participation only counts as a real collaboration once it is committed —
// an INVITED/DECLINED/DROPPED row must NOT inflate relationship history (DB-10).
const COMMITTED_PARTICIPATION = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] as const;
// Auto-promotion to ACTIVE happens only from a pre-active pipeline stage, so a
// human-curated status (RECURRING/PAST/DECLINED/BLACKLISTED) is never stomped.
const PRE_ACTIVE_STATUSES = new Set(['PROSPECT', 'CONTACTED', 'NEGOTIATING']);

export function makeCampaignInfluencerService(ctx: DomainContext) {
  const { prisma } = ctx;

  /**
   * Recompute a brand↔influencer relationship's collaboration stats from the
   * source of truth — the committed CampaignInfluencer rows — instead of
   * incrementing a counter at invite time (DB-10). Idempotent: adding then
   * removing (or inviting then declining) leaves the stats unchanged, because
   * an INVITED/DECLINED/DROPPED participation is never counted.
   */
  async function syncRelationship(brandId: string, influencerId: string): Promise<void> {
    const committed = await prisma.campaignInfluencer.findMany({
      where: {
        influencerId,
        campaign: { brandId },
        participationStatus: { in: [...COMMITTED_PARTICIPATION] },
      },
      select: { createdAt: true, campaign: { select: { startDate: true } } },
    });
    const dates = committed.map((c) => c.campaign.startDate ?? c.createdAt);
    const times = dates.map((d) => d.getTime());
    const firstAt = times.length ? new Date(Math.min(...times)) : null;
    const lastAt = times.length ? new Date(Math.max(...times)) : null;
    const total = committed.length;

    const existing = await prisma.brandInfluencer.findUnique({
      where: { brandId_influencerId: { brandId, influencerId } },
      select: { relationshipStatus: true },
    });
    if (!existing) return; // add() ensures the row exists before syncing
    const promote = total > 0 && PRE_ACTIVE_STATUSES.has(existing.relationshipStatus);

    await prisma.brandInfluencer.update({
      where: { brandId_influencerId: { brandId, influencerId } },
      data: {
        totalCollaborations: total,
        firstCollaborationAt: firstAt,
        lastCampaignAt: lastAt,
        ...(promote ? { relationshipStatus: 'ACTIVE' as const } : {}),
      },
    });
  }

  function toDTO(ci: {
    id: string;
    campaignId: string;
    dealType: CampaignInfluencerDTO['dealType'];
    agreedCost: MoneyInput;
    currency: string | null;
    giftedProductValue: MoneyInput;
    participationStatus: CampaignInfluencerDTO['participationStatus'];
    paymentStatus: CampaignInfluencerDTO['paymentStatus'];
    paidAmount: MoneyInput;
    paidAt: Date | null;
    expectedPublishAt: Date | null;
    dateContacted: Date | null;
    notes: string | null;
    influencer: Parameters<typeof toInfluencerSummary>[0];
    deliverables: Parameters<typeof toDeliverableDTO>[0][];
  }): CampaignInfluencerDTO {
    const deliverables = ci.deliverables.map((d) => toDeliverableDTO(d));
    const published = ci.deliverables.filter((d) =>
      (PUBLISHED as readonly string[]).includes(d.status),
    ).length;
    return {
      id: ci.id,
      campaignId: ci.campaignId,
      influencer: toInfluencerSummary(ci.influencer) as InfluencerSummaryDTO,
      dealType: ci.dealType,
      agreedCost: toMoneyNumber(ci.agreedCost),
      currency: ci.currency,
      giftedProductValue: toMoneyNumber(ci.giftedProductValue),
      participationStatus: ci.participationStatus,
      paymentStatus: ci.paymentStatus,
      paidAmount: toMoneyNumber(ci.paidAmount),
      paidAt: iso(ci.paidAt),
      expectedPublishAt: iso(ci.expectedPublishAt),
      dateContacted: iso(ci.dateContacted),
      notes: ci.notes,
      deliverables,
      deliverableProgress: { published, total: ci.deliverables.length },
    };
  }

  async function listForCampaign(campaignId: string): Promise<CampaignInfluencerDTO[]> {
    const rows = await prisma.campaignInfluencer.findMany({
      where: { campaignId },
      include: {
        influencer: { include: influencerSummaryInclude },
        deliverables: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => toDTO(r));
  }

  async function get(id: string): Promise<CampaignInfluencerDTO> {
    const ci = await prisma.campaignInfluencer.findUnique({
      where: { id },
      include: {
        influencer: { include: influencerSummaryInclude },
        deliverables: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ci) throw AppError.notFound('Campaign influencer');
    return toDTO(ci);
  }

  async function add(input: CIAdd): Promise<CampaignInfluencerDTO> {
    requireActor(ctx);
    const [campaign, influencer] = await Promise.all([
      prisma.campaign.findUnique({ where: { id: input.campaignId }, select: { id: true, name: true, brandId: true } }),
      prisma.influencer.findUnique({ where: { id: input.influencerId }, select: { id: true, displayName: true } }),
    ]);
    if (!campaign) throw AppError.notFound('Campaign');
    if (!influencer) throw AppError.notFound('Influencer');

    const dup = await prisma.campaignInfluencer.findUnique({
      where: { campaignId_influencerId: { campaignId: input.campaignId, influencerId: input.influencerId } },
    });
    if (dup) throw AppError.conflict(`${influencer.displayName} is already on this campaign.`);

    const paymentStatus =
      input.paymentStatus ??
      (input.dealType === 'FREE' || input.dealType === 'GIFTED_PRODUCT' ? 'NOT_APPLICABLE' : 'UNPAID');

    const ci = await prisma.campaignInfluencer.create({
      data: {
        campaignId: input.campaignId,
        influencerId: input.influencerId,
        dealType: input.dealType ?? 'PAID',
        agreedCost: input.agreedCost ?? null,
        currency: input.currency ?? null,
        giftedProductValue: input.giftedProductValue ?? null,
        dateContacted: input.dateContacted ?? null,
        expectedPublishAt: input.expectedPublishAt ?? null,
        participationStatus: input.participationStatus ?? 'INVITED',
        paymentStatus,
        paidAmount: input.paidAmount ?? null,
        paidAt: input.paidAt ?? null,
        notes: input.notes ?? null,
      },
    });

    // Ensure the brand↔influencer relationship row exists, but do NOT count a
    // collaboration or force it ACTIVE at invite time (DB-10) — being added to a
    // campaign is not yet a confirmed collaboration. Real stats are derived by
    // syncRelationship from committed participations only.
    await prisma.brandInfluencer.upsert({
      where: { brandId_influencerId: { brandId: campaign.brandId, influencerId: influencer.id } },
      create: { brandId: campaign.brandId, influencerId: influencer.id },
      update: {},
    });
    await syncRelationship(campaign.brandId, influencer.id);

    await logActivity(ctx, {
      type: 'INFLUENCER_ADDED_TO_CAMPAIGN',
      message: `${ctx.actor?.name ?? 'Someone'} added ${influencer.displayName} to ${campaign.name}.`,
      brandId: campaign.brandId,
      campaignId: campaign.id,
      influencerId: influencer.id,
    });
    return get(ci.id);
  }

  async function update(id: string, input: CIUpdate): Promise<CampaignInfluencerDTO> {
    requireActor(ctx);
    const existing = await prisma.campaignInfluencer.findUnique({
      where: { id },
      select: { campaignId: true, influencerId: true },
    });
    if (!existing) throw AppError.notFound('Campaign influencer');
    await prisma.campaignInfluencer.update({
      where: { id },
      data: {
        dealType: input.dealType ?? undefined,
        agreedCost: input.agreedCost === undefined ? undefined : input.agreedCost,
        currency: input.currency === undefined ? undefined : input.currency,
        giftedProductValue: input.giftedProductValue === undefined ? undefined : input.giftedProductValue,
        dateContacted: input.dateContacted === undefined ? undefined : input.dateContacted,
        expectedPublishAt: input.expectedPublishAt === undefined ? undefined : input.expectedPublishAt,
        participationStatus: input.participationStatus ?? undefined,
        paymentStatus: input.paymentStatus ?? undefined,
        paidAmount: input.paidAmount === undefined ? undefined : input.paidAmount,
        paidAt: input.paidAt === undefined ? undefined : input.paidAt,
        notes: input.notes === undefined ? undefined : input.notes,
      },
    });
    // A participation-status change may make this a (newly) committed or no
    // longer committed collaboration — recompute the relationship stats.
    const campaign = await prisma.campaign.findUnique({
      where: { id: existing.campaignId },
      select: { brandId: true },
    });
    if (campaign) await syncRelationship(campaign.brandId, existing.influencerId);
    return get(id);
  }

  async function remove(id: string): Promise<void> {
    requireActor(ctx);
    const existing = await prisma.campaignInfluencer.findUnique({
      where: { id },
      select: { campaignId: true, influencerId: true },
    });
    if (!existing) throw AppError.notFound('Campaign influencer');
    const campaign = await prisma.campaign.findUnique({
      where: { id: existing.campaignId },
      select: { brandId: true },
    });
    await prisma.campaignInfluencer.delete({ where: { id } });
    // Removing a participation must not leave inflated stats behind.
    if (campaign) await syncRelationship(campaign.brandId, existing.influencerId);
  }

  return { listForCampaign, get, add, update, remove };
}

export type CampaignInfluencerService = ReturnType<typeof makeCampaignInfluencerService>;
