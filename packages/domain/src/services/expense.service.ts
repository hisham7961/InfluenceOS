import { requests, type CostSummaryDTO, type ExpenseDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireCapability } from '../lib/authz';
import { logActivity } from '../lib/helpers';
import { moneyNumberOr0, toMoneyNumber } from '../lib/money';
import { toExpenseDTO } from '../lib/mappers';
import { computeCostSummary } from '../lib/progress';
import { PAID_DEALS } from '../lib/spend';
import { makeCampaignService } from './campaign.service';
import { applyLegacyPaymentFields, syncPaidState } from '../lib/payments';

type ExpenseCreate = z.infer<typeof requests.expenseCreateSchema>;
type ExpenseUpdate = z.infer<typeof requests.expenseUpdateSchema>;

export function makeExpenseService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function listForCampaign(
    campaignId: string,
  ): Promise<{ expenses: ExpenseDTO[]; summary: CostSummaryDTO }> {
    // A campaign's expenses and what is paid / still owed are finance data
    // (P2.3): people without finance access don't get them.
    await requireCapability(ctx, 'FINANCE_VIEW');
    await makeCampaignService(ctx).assertInScope(campaignId);
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { currency: true, plannedBudget: true },
    });
    if (!campaign) throw AppError.notFound('Campaign');

    const [rows, summary] = await Promise.all([
      prisma.campaignExpense.findMany({
        where: { campaignId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      computeCostSummary(ctx, campaignId, campaign.currency, toMoneyNumber(campaign.plannedBudget)),
    ]);

    return { expenses: rows.map(toExpenseDTO), summary };
  }

  /**
   * A creator's fee lives on their roster row (agreed cost). An
   * INFLUENCER_FEE expense for a creator who already has one would count the
   * same fee twice in spend, so it is refused; extra costs for that creator
   * go under another type (production, other…).
   */
  async function assertNotRepeatedFee(type: string, campaignInfluencerId: string | null | undefined): Promise<void> {
    if (type !== 'INFLUENCER_FEE' || !campaignInfluencerId) return;
    const ci = await prisma.campaignInfluencer.findUnique({
      where: { id: campaignInfluencerId },
      select: { dealType: true, agreedCost: true },
    });
    if (ci && ci.agreedCost != null && (PAID_DEALS as readonly string[]).includes(ci.dealType)) {
      throw AppError.conflict(
        "This creator's fee is already recorded as their agreed cost on the roster. Update it there (or record the payment), or add extra costs under another expense type.",
      );
    }
  }

  async function create(input: ExpenseCreate): Promise<ExpenseDTO> {
    const actor = await requireCapability(ctx, 'FINANCE_MANAGE');
    // FINANCE_MANAGE grants WHAT; brand scope grants WHERE — a brand-scoped
    // finance actor must not create an expense against a campaign outside
    // their brand access (section 43).
    await makeCampaignService(ctx).assertInScope(input.campaignId);

    if (input.campaignInfluencerId) {
      const ci = await prisma.campaignInfluencer.findUnique({
        where: { id: input.campaignInfluencerId },
        select: { id: true, campaignId: true },
      });
      if (!ci || ci.campaignId !== input.campaignId) {
        throw AppError.badRequest('The selected influencer is not part of this campaign.');
      }
    }
    await assertNotRepeatedFee(input.type, input.campaignInfluencerId);

    const expense = await prisma.$transaction(async (tx) => {
      const row = await tx.campaignExpense.create({
        data: {
          campaignId: input.campaignId,
          campaignInfluencerId: input.campaignInfluencerId ?? null,
          type: input.type,
          label: input.label ?? null,
          amount: input.amount,
          currency: input.currency,
          paymentStatus: 'UNPAID',
          incurredAt: input.incurredAt ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
        },
      });
      // Already paid (in full or in part): that goes into the payment ledger.
      const target = { expenseId: row.id };
      await applyLegacyPaymentFields(ctx, tx, target, {
        paymentStatus: input.paymentStatus,
        paidAmount: input.paidAmount,
        paidAt: input.paidAt,
      });
      await syncPaidState(tx, target);
      return tx.campaignExpense.findUniqueOrThrow({ where: { id: row.id } });
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
    const actor = await requireCapability(ctx, 'FINANCE_MANAGE');
    const existing = await prisma.campaignExpense.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw AppError.notFound('Expense');
    await makeCampaignService(ctx).assertInScope(existing.campaignId);
    if (input.currency !== undefined && input.currency !== existing.currency) {
      const paid = await prisma.payment.count({ where: { expenseId: id, voidedAt: null } });
      if (paid > 0) throw AppError.conflict('Payments in the old currency are recorded for this expense. Void them before changing the currency.');
    }

    if (input.campaignInfluencerId !== undefined && input.campaignInfluencerId !== null) {
      const ci = await prisma.campaignInfluencer.findUnique({
        where: { id: input.campaignInfluencerId },
        select: { id: true, campaignId: true },
      });
      if (!ci || ci.campaignId !== existing.campaignId) {
        throw AppError.badRequest('The selected influencer is not part of this campaign.');
      }
    }
    // Only a change of type or creator is checked, so older rows stay editable.
    if (input.type !== undefined || input.campaignInfluencerId !== undefined) {
      await assertNotRepeatedFee(
        input.type ?? existing.type,
        input.campaignInfluencerId === undefined ? existing.campaignInfluencerId : input.campaignInfluencerId,
      );
    }

    const expense = await prisma.$transaction(async (tx) => {
      await tx.campaignExpense.update({
        where: { id },
        data: {
          campaignInfluencerId:
            input.campaignInfluencerId === undefined ? undefined : input.campaignInfluencerId,
          type: input.type ?? undefined,
          label: input.label === undefined ? undefined : input.label,
          amount: input.amount ?? undefined,
          currency: input.currency ?? undefined,
          incurredAt: input.incurredAt === undefined ? undefined : input.incurredAt,
          notes: input.notes === undefined ? undefined : input.notes,
        },
      });
      const target = { expenseId: id };
      await applyLegacyPaymentFields(ctx, tx, target, {
        paymentStatus: input.paymentStatus,
        paidAmount: input.paidAmount,
        paidAt: input.paidAt,
      });
      await syncPaidState(tx, target);
      return tx.campaignExpense.findUniqueOrThrow({ where: { id } });
    });

    await logActivity(ctx, {
      type: 'COST_UPDATED',
      message: `${actor.name} updated a ${expense.type.toLowerCase().replace(/_/g, ' ')} expense of ${expense.amount} ${expense.currency}.`,
      campaignId: expense.campaignId,
      meta: { amount: moneyNumberOr0(expense.amount), currency: expense.currency, type: expense.type },
    });

    return toExpenseDTO(expense);
  }

  /**
   * Deleting an expense puts it in the campaign's trash: it leaves every
   * total and list but can be restored. One with payments recorded against
   * it can't be deleted — money that went out stays on record; void the
   * payments first if the whole thing was a mistake.
   */
  async function remove(id: string): Promise<void> {
    const actor = await requireCapability(ctx, 'FINANCE_MANAGE');
    const existing = await prisma.campaignExpense.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw AppError.notFound('Expense');
    await makeCampaignService(ctx).assertInScope(existing.campaignId);
    const paid = await prisma.payment.count({ where: { expenseId: id, voidedAt: null } });
    if (paid > 0) {
      throw AppError.conflict('Payments are recorded for this expense. Void them first if it was entered by mistake.');
    }
    await prisma.campaignExpense.update({ where: { id }, data: { deletedAt: new Date(), deletedById: actor.id } });
    await logActivity(ctx, {
      type: 'COST_UPDATED',
      message: `${actor.name} moved a ${existing.type.toLowerCase().replace(/_/g, ' ')} expense of ${existing.amount} ${existing.currency} to the trash.`,
      campaignId: existing.campaignId,
      meta: { expenseId: id },
    });
  }

  /** The campaign's deleted expenses, newest first. */
  async function listTrash(campaignId: string): Promise<ExpenseDTO[]> {
    await requireCapability(ctx, 'FINANCE_VIEW');
    await makeCampaignService(ctx).assertInScope(campaignId);
    const rows = await prisma.campaignExpense.findMany({
      where: { campaignId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
    return rows.map(toExpenseDTO);
  }

  async function restore(id: string): Promise<ExpenseDTO> {
    const actor = await requireCapability(ctx, 'FINANCE_MANAGE');
    const existing = await prisma.campaignExpense.findUnique({ where: { id } });
    if (!existing || !existing.deletedAt) throw AppError.notFound('Expense');
    await makeCampaignService(ctx).assertInScope(existing.campaignId);
    const restored = await prisma.campaignExpense.update({ where: { id }, data: { deletedAt: null, deletedById: null } });
    await logActivity(ctx, {
      type: 'COST_UPDATED',
      message: `${actor.name} restored a ${existing.type.toLowerCase().replace(/_/g, ' ')} expense of ${existing.amount} ${existing.currency} from the trash.`,
      campaignId: existing.campaignId,
      meta: { expenseId: id },
    });
    return toExpenseDTO(restored);
  }

  return { listForCampaign, create, update, remove, listTrash, restore };
}

export type ExpenseService = ReturnType<typeof makeExpenseService>;
