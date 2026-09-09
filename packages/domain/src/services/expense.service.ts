import { requests, type CostSummaryDTO, type ExpenseDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { logActivity } from '../lib/helpers';
import { moneyNumberOr0, toMoneyNumber } from '../lib/money';
import { toExpenseDTO } from '../lib/mappers';
import { computeCostSummary } from '../lib/progress';

type ExpenseCreate = z.infer<typeof requests.expenseCreateSchema>;
type ExpenseUpdate = z.infer<typeof requests.expenseUpdateSchema>;

export function makeExpenseService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function listForCampaign(
    campaignId: string,
  ): Promise<{ expenses: ExpenseDTO[]; summary: CostSummaryDTO }> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { currency: true, plannedBudget: true },
    });
    if (!campaign) throw AppError.notFound('Campaign');

    const [rows, summary] = await Promise.all([
      prisma.campaignExpense.findMany({
        where: { campaignId },
        orderBy: { createdAt: 'desc' },
      }),
      computeCostSummary(ctx, campaignId, campaign.currency, toMoneyNumber(campaign.plannedBudget)),
    ]);

    return { expenses: rows.map(toExpenseDTO), summary };
  }

  async function create(input: ExpenseCreate): Promise<ExpenseDTO> {
    const actor = requireActor(ctx);

    const campaign = await prisma.campaign.findUnique({
      where: { id: input.campaignId },
      select: { id: true },
    });
    if (!campaign) throw AppError.notFound('Campaign');

    if (input.campaignInfluencerId) {
      const ci = await prisma.campaignInfluencer.findUnique({
        where: { id: input.campaignInfluencerId },
        select: { id: true, campaignId: true },
      });
      if (!ci || ci.campaignId !== input.campaignId) {
        throw AppError.badRequest('The selected influencer is not part of this campaign.');
      }
    }

    const expense = await prisma.campaignExpense.create({
      data: {
        campaignId: input.campaignId,
        campaignInfluencerId: input.campaignInfluencerId ?? null,
        type: input.type,
        label: input.label ?? null,
        amount: input.amount,
        currency: input.currency,
        paymentStatus: input.paymentStatus,
        incurredAt: input.incurredAt ?? null,
        notes: input.notes ?? null,
        createdById: actor.id,
      },
    });

    await logActivity(ctx, {
      type: 'COST_ADDED',
      message: `${actor.name} added a ${expense.type.toLowerCase().replace(/_/g, ' ')} expense of ${expense.amount} ${expense.currency}.`,
      campaignId: expense.campaignId,
      meta: { amount: moneyNumberOr0(expense.amount), currency: expense.currency, type: expense.type },
    });

    return toExpenseDTO(expense);
  }

  async function update(id: string, input: ExpenseUpdate): Promise<ExpenseDTO> {
    const actor = requireActor(ctx);
    const existing = await prisma.campaignExpense.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Expense');

    if (input.campaignInfluencerId !== undefined && input.campaignInfluencerId !== null) {
      const ci = await prisma.campaignInfluencer.findUnique({
        where: { id: input.campaignInfluencerId },
        select: { id: true, campaignId: true },
      });
      if (!ci || ci.campaignId !== existing.campaignId) {
        throw AppError.badRequest('The selected influencer is not part of this campaign.');
      }
    }

    const expense = await prisma.campaignExpense.update({
      where: { id },
      data: {
        campaignInfluencerId:
          input.campaignInfluencerId === undefined ? undefined : input.campaignInfluencerId,
        type: input.type ?? undefined,
        label: input.label === undefined ? undefined : input.label,
        amount: input.amount ?? undefined,
        currency: input.currency ?? undefined,
        paymentStatus: input.paymentStatus ?? undefined,
        incurredAt: input.incurredAt === undefined ? undefined : input.incurredAt,
        notes: input.notes === undefined ? undefined : input.notes,
      },
    });

    await logActivity(ctx, {
      type: 'COST_UPDATED',
      message: `${actor.name} updated a ${expense.type.toLowerCase().replace(/_/g, ' ')} expense of ${expense.amount} ${expense.currency}.`,
      campaignId: expense.campaignId,
      meta: { amount: moneyNumberOr0(expense.amount), currency: expense.currency, type: expense.type },
    });

    return toExpenseDTO(expense);
  }

  async function remove(id: string): Promise<void> {
    requireActor(ctx);
    const existing = await prisma.campaignExpense.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Expense');
    await prisma.campaignExpense.delete({ where: { id } });
  }

  return { listForCampaign, create, update, remove };
}

export type ExpenseService = ReturnType<typeof makeExpenseService>;
