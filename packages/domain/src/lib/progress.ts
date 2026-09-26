import type { CampaignProgressDTO, CostSummaryDTO } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { countsTowardCompletion, daysUntilDue, isDeliverableDelivered } from '@influenceos/shared';
import { percentOf, toMoneyNumber } from './money';
import { countedWhere, deliveredWhere } from './deliverable-rules';
import { campaignMoney, type ExpenseMoneyRow, type ParticipationMoneyRow } from './spend';

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
  }
  // Calendar days in Kuwait: 0 on the last day, not a rounded 24-hour count.
  if (campaign.endDate) daysRemaining = daysUntilDue(campaign.endDate);

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
      prisma.deliverable.count({ where: { AND: [where, countedWhere] } }),
      prisma.deliverable.count({ where: { AND: [where, deliveredWhere] } }),
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
      where: { campaignId: { in: ids }, deletedAt: null },
      select: { campaignId: true, campaignInfluencerId: true, type: true, amount: true, paymentStatus: true, paidAmount: true },
    }),
  ]);

  const ciIds = cis.map((c) => c.id);
  const deliverables = ciIds.length
    ? await prisma.deliverable.findMany({
        where: { campaignInfluencerId: { in: ciIds } },
        select: { campaignInfluencerId: true, status: true, type: true },
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
    if (!countsTowardCompletion(d)) continue;
    delTotal.set(cid, (delTotal.get(cid) ?? 0) + 1);
    if (isDeliverableDelivered(d)) delPublished.set(cid, (delPublished.get(cid) ?? 0) + 1);
  }

  for (const campaign of campaigns) {
    const cCis = cisByCampaign.get(campaign.id) ?? [];
    const cost = costSummaryFrom(
      cCis,
      expByCampaign.get(campaign.id) ?? [],
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
 * Campaign money summary — the rules live in spend.ts (fees from the roster's
 * agreed cost, ended participations count only what was paid, a fee expense
 * that repeats a roster fee is not counted twice).
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
      select: {
        id: true,
        dealType: true,
        agreedCost: true,
        giftedProductValue: true,
        participationStatus: true,
        paymentStatus: true,
        paidAmount: true,
      },
    }),
    prisma.campaignExpense.findMany({
      where: { campaignId, deletedAt: null },
      select: { campaignInfluencerId: true, type: true, amount: true, paymentStatus: true, paidAmount: true },
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
  cis: ParticipationMoneyRow[],
  expenses: ExpenseMoneyRow[],
  currency: string,
  plannedBudget: number | null,
): CostSummaryDTO {
  const { influencerFees, giftValue, otherExpenses, totalSpend, paid, unpaid } = campaignMoney(cis, expenses);

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
