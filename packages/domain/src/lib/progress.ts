import type { CampaignProgressDTO, CostSummaryDTO } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { dec } from './helpers';

const PUBLISHED_DELIVERABLE_STATUSES = ['PUBLISHED', 'VERIFIED'] as const;

interface CampaignForProgress {
  id: string;
  startDate: Date | null;
  endDate: Date | null;
  plannedBudget: unknown;
  currency: string;
}

/**
 * Campaign progress derived from deliverables + costs (spec §55). Never a
 * manual percentage. Business logic lives here (server-side) so Web and Mobile
 * always receive identical results (addendum §3).
 */
export async function computeCampaignProgress(
  ctx: DomainContext,
  campaign: CampaignForProgress,
): Promise<CampaignProgressDTO> {
  const { prisma } = ctx;
  const where = { campaignInfluencer: { campaignId: campaign.id } };

  const [deliverablesTotal, deliverablesPublished, influencersTotal, influencersCompleted, cost] =
    await Promise.all([
      prisma.deliverable.count({ where }),
      prisma.deliverable.count({
        where: { ...where, status: { in: [...PUBLISHED_DELIVERABLE_STATUSES] } },
      }),
      prisma.campaignInfluencer.count({ where: { campaignId: campaign.id } }),
      prisma.campaignInfluencer.count({
        where: { campaignId: campaign.id, participationStatus: 'COMPLETED' },
      }),
      computeCostSummary(ctx, campaign.id, campaign.currency, dec(campaign.plannedBudget as never)),
    ]);

  const deliverableCompletion =
    deliverablesTotal > 0 ? Math.round((deliverablesPublished / deliverablesTotal) * 100) : 0;

  let timeElapsedPercent: number | null = null;
  let daysRemaining: number | null = null;
  if (campaign.startDate && campaign.endDate) {
    const start = campaign.startDate.getTime();
    const end = campaign.endDate.getTime();
    const now = Date.now();
    if (end > start) {
      timeElapsedPercent = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
    }
    daysRemaining = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  } else if (campaign.endDate) {
    daysRemaining = Math.ceil((campaign.endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }

  return {
    deliverablesTotal,
    deliverablesPublished,
    deliverableCompletion,
    influencersTotal,
    influencersCompleted,
    timeElapsedPercent,
    spend: cost.totalSpend,
    plannedBudget: cost.plannedBudget,
    budgetUsedPercent: cost.budgetUsedPercent,
    daysRemaining,
  };
}

/**
 * Single source of truth for campaign money. Influencer fees come from
 * CampaignInfluencer.agreedCost (paid deals); CampaignExpense holds all other
 * expenses. No double counting.
 */
export async function computeCostSummary(
  ctx: DomainContext,
  campaignId: string,
  currency: string,
  plannedBudget: number | null,
): Promise<CostSummaryDTO> {
  const { prisma } = ctx;

  const [cis, expenses] = await Promise.all([
    prisma.campaignInfluencer.findMany({
      where: { campaignId },
      select: { dealType: true, agreedCost: true, giftedProductValue: true, paymentStatus: true },
    }),
    prisma.campaignExpense.findMany({
      where: { campaignId },
      select: { type: true, amount: true, paymentStatus: true },
    }),
  ]);

  let influencerFees = 0;
  let giftValue = 0;
  let paid = 0;
  let unpaid = 0;

  for (const ci of cis) {
    const fee = dec(ci.agreedCost) ?? 0;
    const gift = dec(ci.giftedProductValue) ?? 0;
    if (ci.dealType === 'PAID' || ci.dealType === 'PAID_PLUS_GIFTED') {
      influencerFees += fee;
      if (ci.paymentStatus === 'PAID') paid += fee;
      else if (ci.paymentStatus !== 'NOT_APPLICABLE') unpaid += fee;
    }
    giftValue += gift;
  }

  let otherExpenses = 0;
  for (const e of expenses) {
    const amount = dec(e.amount) ?? 0;
    if (e.type === 'GIFT_PRODUCT') {
      giftValue += amount;
    } else {
      otherExpenses += amount;
    }
    if (e.paymentStatus === 'PAID') paid += amount;
    else if (e.paymentStatus !== 'NOT_APPLICABLE') unpaid += amount;
  }

  const totalSpend = influencerFees + otherExpenses;
  const budgetUsedPercent =
    plannedBudget && plannedBudget > 0 ? Math.round((totalSpend / plannedBudget) * 100) : null;

  return {
    currency,
    plannedBudget,
    totalSpend,
    influencerFees,
    giftValue,
    otherExpenses,
    paid,
    unpaid,
    budgetUsedPercent,
  };
}
