import { Prisma } from '@influenceos/database';
import type { CampaignProgressDTO, CostSummaryDTO } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { percentOf, toDecimal, toMoneyNumber, type MoneyInput } from './money';

const PUBLISHED_DELIVERABLE_STATUSES = ['PUBLISHED', 'VERIFIED', 'APPROVED'] as const;

/**
 * Split an amount into its paid / unpaid parts by payment status. A
 * PARTIALLY_PAID row uses its recorded `paidAmount` (clamped to [0, amount]) so
 * a 1,500-of-3,000 fee reports 1,500 paid + 1,500 unpaid, not 3,000 unpaid
 * (finance P1). A missing paidAmount on a partial payment counts as 0 paid.
 */
function splitPayment(
  amount: Prisma.Decimal,
  status: string,
  paidAmount: MoneyInput,
): { paid: Prisma.Decimal; unpaid: Prisma.Decimal } {
  const zero = new Prisma.Decimal(0);
  if (status === 'PAID') return { paid: amount, unpaid: zero };
  if (status === 'UNPAID') return { paid: zero, unpaid: amount };
  if (status === 'PARTIALLY_PAID') {
    let paid = toDecimal(paidAmount) ?? zero;
    if (paid.lt(zero)) paid = zero;
    if (paid.gt(amount)) paid = amount;
    return { paid, unpaid: amount.minus(paid) };
  }
  return { paid: zero, unpaid: zero }; // NOT_APPLICABLE
}

interface CampaignForProgress {
  id: string;
  startDate: Date | null;
  endDate: Date | null;
  plannedBudget: unknown;
  currency: string;
}

interface ProgressCounts {
  deliverablesTotal: number;
  deliverablesPublished: number;
  influencersTotal: number;
  influencersCompleted: number;
}

/** Assemble a CampaignProgressDTO from already-computed counts + cost (pure). */
function progressFrom(
  campaign: CampaignForProgress,
  counts: ProgressCounts,
  cost: CostSummaryDTO,
): CampaignProgressDTO {
  const deliverableCompletion =
    counts.deliverablesTotal > 0
      ? Math.round((counts.deliverablesPublished / counts.deliverablesTotal) * 100)
      : 0;

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
    deliverablesTotal: counts.deliverablesTotal,
    deliverablesPublished: counts.deliverablesPublished,
    deliverableCompletion,
    influencersTotal: counts.influencersTotal,
    influencersCompleted: counts.influencersCompleted,
    timeElapsedPercent,
    spend: cost.totalSpend,
    plannedBudget: cost.plannedBudget,
    budgetUsedPercent: cost.budgetUsedPercent,
    daysRemaining,
  };
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
      computeCostSummary(ctx, campaign.id, campaign.currency, toMoneyNumber(campaign.plannedBudget as never)),
    ]);

  return progressFrom(
    campaign,
    { deliverablesTotal, deliverablesPublished, influencersTotal, influencersCompleted },
    cost,
  );
}

// Cost input rows (already fetched). Kept structural so both the per-campaign
// and the batched paths can share the exact Decimal accumulation.
type CiCostRow = {
  dealType: string;
  agreedCost: MoneyInput;
  giftedProductValue: MoneyInput;
  paymentStatus: string;
  paidAmount: MoneyInput;
};
type ExpenseCostRow = { type: string; amount: MoneyInput; paymentStatus: string; paidAmount: MoneyInput };

/**
 * Compute the whole campaign list's progress in a fixed THREE queries regardless
 * of page size (PERF-01 / W7-1) — no per-campaign fan-out. Returns a map keyed
 * by campaign id. The numbers are identical to computeCampaignProgress().
 */
export async function computeCampaignProgressBatch(
  ctx: DomainContext,
  campaigns: CampaignForProgress[],
): Promise<Map<string, CampaignProgressDTO>> {
  const { prisma } = ctx;
  const out = new Map<string, CampaignProgressDTO>();
  const ids = campaigns.map((c) => c.id);
  if (ids.length === 0) return out;

  const [cis, expenses] = await Promise.all([
    prisma.campaignInfluencer.findMany({
      where: { campaignId: { in: ids } },
      select: {
        id: true,
        campaignId: true,
        participationStatus: true,
        dealType: true,
        agreedCost: true,
        giftedProductValue: true,
        paymentStatus: true,
        paidAmount: true,
      },
    }),
    prisma.campaignExpense.findMany({
      where: { campaignId: { in: ids } },
      select: { campaignId: true, type: true, amount: true, paymentStatus: true, paidAmount: true },
    }),
  ]);

  const ciIds = cis.map((c) => c.id);
  const deliverables = ciIds.length
    ? await prisma.deliverable.findMany({
        where: { campaignInfluencerId: { in: ciIds } },
        select: { campaignInfluencerId: true, status: true },
      })
    : [];

  const ciToCampaign = new Map(cis.map((c) => [c.id, c.campaignId]));
  const cisByCampaign = new Map<string, typeof cis>();
  const expByCampaign = new Map<string, typeof expenses>();
  for (const c of cis) (cisByCampaign.get(c.campaignId) ?? cisByCampaign.set(c.campaignId, []).get(c.campaignId)!).push(c);
  for (const e of expenses) (expByCampaign.get(e.campaignId) ?? expByCampaign.set(e.campaignId, []).get(e.campaignId)!).push(e);

  const delTotal = new Map<string, number>();
  const delPublished = new Map<string, number>();
  for (const d of deliverables) {
    const cid = ciToCampaign.get(d.campaignInfluencerId);
    if (!cid) continue;
    delTotal.set(cid, (delTotal.get(cid) ?? 0) + 1);
    if ((PUBLISHED_DELIVERABLE_STATUSES as readonly string[]).includes(d.status)) {
      delPublished.set(cid, (delPublished.get(cid) ?? 0) + 1);
    }
  }

  for (const campaign of campaigns) {
    const cCis = cisByCampaign.get(campaign.id) ?? [];
    const cost = costSummaryFrom(
      cCis as CiCostRow[],
      (expByCampaign.get(campaign.id) ?? []) as ExpenseCostRow[],
      campaign.currency,
      toMoneyNumber(campaign.plannedBudget as never),
    );
    out.set(
      campaign.id,
      progressFrom(
        campaign,
        {
          deliverablesTotal: delTotal.get(campaign.id) ?? 0,
          deliverablesPublished: delPublished.get(campaign.id) ?? 0,
          influencersTotal: cCis.length,
          influencersCompleted: cCis.filter((c) => c.participationStatus === 'COMPLETED').length,
        },
        cost,
      ),
    );
  }
  return out;
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
      select: { dealType: true, agreedCost: true, giftedProductValue: true, paymentStatus: true, paidAmount: true },
    }),
    prisma.campaignExpense.findMany({
      where: { campaignId },
      select: { type: true, amount: true, paymentStatus: true, paidAmount: true },
    }),
  ]);

  return costSummaryFrom(cis, expenses, currency, plannedBudget);
}

/**
 * Pure campaign-cost accumulation from already-fetched rows — exact Decimal
 * arithmetic, never JS float (§ money.ts). Shared by the per-campaign and the
 * batched (W7-1) paths so both produce identical money.
 */
function costSummaryFrom(
  cis: CiCostRow[],
  expenses: ExpenseCostRow[],
  currency: string,
  plannedBudget: number | null,
): CostSummaryDTO {
  let influencerFees = new Prisma.Decimal(0);
  let giftValue = new Prisma.Decimal(0);
  let paid = new Prisma.Decimal(0);
  let unpaid = new Prisma.Decimal(0);

  for (const ci of cis) {
    // FREE deals keep an exact 0; a missing cost contributes nothing (not 0-as-fact).
    const fee = toDecimal(ci.agreedCost) ?? new Prisma.Decimal(0);
    const gift = toDecimal(ci.giftedProductValue) ?? new Prisma.Decimal(0);
    if (ci.dealType === 'PAID' || ci.dealType === 'PAID_PLUS_GIFTED') {
      influencerFees = influencerFees.plus(fee);
      const split = splitPayment(fee, ci.paymentStatus, ci.paidAmount);
      paid = paid.plus(split.paid);
      unpaid = unpaid.plus(split.unpaid);
    }
    giftValue = giftValue.plus(gift);
  }

  let otherExpenses = new Prisma.Decimal(0);
  for (const e of expenses) {
    const amount = toDecimal(e.amount) ?? new Prisma.Decimal(0);
    if (e.type === 'GIFT_PRODUCT') {
      giftValue = giftValue.plus(amount);
    } else {
      otherExpenses = otherExpenses.plus(amount);
    }
    const split = splitPayment(amount, e.paymentStatus, e.paidAmount);
    paid = paid.plus(split.paid);
    unpaid = unpaid.plus(split.unpaid);
  }

  const totalSpend = influencerFees.plus(otherExpenses);

  return {
    currency,
    plannedBudget,
    totalSpend: totalSpend.toNumber(),
    influencerFees: influencerFees.toNumber(),
    giftValue: giftValue.toNumber(),
    otherExpenses: otherExpenses.toNumber(),
    paid: paid.toNumber(),
    unpaid: unpaid.toNumber(),
    budgetUsedPercent: percentOf(totalSpend, plannedBudget),
  };
}
