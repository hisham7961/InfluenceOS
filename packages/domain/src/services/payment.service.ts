import type {
  CurrencyTotalDTO,
  PayableDTO,
  PayablesPageDTO,
  PaymentDTO,
  PaymentsPageDTO,
  z,
} from '@influenceos/contracts';
import { buildOffsetPagination, requests } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireCapability } from '../lib/authz';
import { iso, logActivity } from '../lib/helpers';
import { moneyNumberOr0 } from '../lib/money';
import { balanceOf, syncPaidState, type PaymentTarget } from '../lib/payments';
import { isBrandOutOfScope, scopedBrandIds } from '../lib/scope';
import { ENDED_PARTICIPATION, PAID_DEALS, splitPayment } from '../lib/spend';
import { attachmentSelect, toAttachmentDTO } from './attachment.service';

type PaymentCreate = z.infer<typeof requests.paymentCreateSchema>;
type PayablesQuery = z.infer<typeof requests.payablesQuerySchema>;
type PaymentsQuery = z.infer<typeof requests.paymentsQuerySchema>;

const paymentInclude = {
  campaign: { select: { name: true, brand: { select: { name: true } } } },
  campaignInfluencer: { select: { influencerId: true, influencer: { select: { displayName: true } } } },
  expense: {
    select: {
      type: true,
      label: true,
      campaignInfluencer: { select: { influencerId: true, influencer: { select: { displayName: true } } } },
    },
  },
  receipt: { select: attachmentSelect },
  createdBy: { select: { name: true } },
  voidedBy: { select: { name: true } },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

async function toPaymentDTO(p: PaymentRow): Promise<PaymentDTO> {
  const creator = p.campaignInfluencer ?? p.expense?.campaignInfluencer ?? null;
  return {
    id: p.id,
    kind: p.campaignInfluencerId ? 'FEE' : 'EXPENSE',
    campaignId: p.campaignId,
    campaignName: p.campaign.name,
    brandName: p.campaign.brand.name,
    campaignInfluencerId: p.campaignInfluencerId,
    expenseId: p.expenseId,
    influencerId: creator?.influencerId ?? null,
    influencerName: creator?.influencer.displayName ?? null,
    expenseType: p.expense?.type ?? null,
    expenseLabel: p.expense?.label ?? null,
    amount: moneyNumberOr0(p.amount),
    currency: p.currency,
    paidAt: p.paidAt.toISOString(),
    method: p.method,
    reference: p.reference,
    notes: p.notes,
    receipt: p.receipt ? await toAttachmentDTO(p.receipt) : null,
    recordedByName: p.createdBy?.name ?? null,
    createdAt: p.createdAt.toISOString(),
    voidedAt: iso(p.voidedAt),
    voidedByName: p.voidedBy?.name ?? null,
    voidReason: p.voidReason,
  };
}

function sumByCurrency(rows: { currency: string; amount: Prisma.Decimal | number }[]): CurrencyTotalDTO[] {
  const totals = new Map<string, Prisma.Decimal>();
  for (const r of rows) {
    totals.set(r.currency, (totals.get(r.currency) ?? new Prisma.Decimal(0)).plus(r.amount));
  }
  return [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount: moneyNumberOr0(amount) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

/**
 * The payment ledger and what is still owed (P2.3). Reading needs
 * FINANCE_VIEW, recording or voiding a payment FINANCE_MANAGE; both stay
 * inside the reader's brand scope.
 */
export function makePaymentService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function brandWhere(): Promise<Prisma.CampaignWhereInput> {
    const scope = await scopedBrandIds(ctx);
    return scope === null ? {} : { brandId: { in: scope } };
  }

  async function assertCampaignInScope(campaignId: string): Promise<{ id: string; name: string; brandId: string }> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true, name: true, brandId: true } });
    if (!campaign) throw AppError.notFound('Campaign');
    if (isBrandOutOfScope(await scopedBrandIds(ctx), campaign.brandId)) throw AppError.notFound('Campaign');
    return campaign;
  }

  async function get(id: string): Promise<PaymentDTO> {
    const p = await prisma.payment.findUnique({ where: { id }, include: paymentInclude });
    if (!p) throw AppError.notFound('Payment');
    return toPaymentDTO(p);
  }

  async function record(target: PaymentTarget, input: PaymentCreate): Promise<PaymentDTO> {
    const actor = await requireCapability(ctx, 'FINANCE_MANAGE');
    let campaignId: string;
    let who: string;
    if ('campaignInfluencerId' in target) {
      const ci = await prisma.campaignInfluencer.findUnique({
        where: { id: target.campaignInfluencerId },
        select: { campaignId: true, dealType: true, agreedCost: true, influencer: { select: { displayName: true } } },
      });
      if (!ci) throw AppError.notFound('Campaign influencer');
      campaignId = ci.campaignId;
      who = ci.influencer.displayName;
      await assertCampaignInScope(campaignId);
      if (!(PAID_DEALS as readonly string[]).includes(ci.dealType)) {
        throw AppError.conflict(`${who} isn't on a paid deal, so there is no fee to pay.`);
      }
      if (ci.agreedCost == null || ci.agreedCost.lte(0)) {
        throw AppError.conflict(`Set ${who}'s agreed fee first, then record what was paid.`);
      }
    } else {
      const e = await prisma.campaignExpense.findUnique({
        where: { id: target.expenseId },
        select: { campaignId: true, label: true, type: true, deletedAt: true },
      });
      if (!e || e.deletedAt) throw AppError.notFound('Expense');
      campaignId = e.campaignId;
      who = e.label ?? e.type.toLowerCase().replace(/_/g, ' ');
      await assertCampaignInScope(campaignId);
    }

    if (input.receiptAttachmentId) {
      const file = await prisma.attachment.findUnique({
        where: { id: input.receiptAttachmentId },
        select: { campaignId: true, campaignInfluencer: { select: { campaignId: true } } },
      });
      if (!file || (file.campaignId ?? file.campaignInfluencer?.campaignId) !== campaignId) {
        throw AppError.badRequest('The receipt must be a file uploaded to this campaign.');
      }
    }

    const payment = await prisma.$transaction(async (tx) => {
      const { balance, currency } = await balanceOf(tx, target);
      const amount = new Prisma.Decimal(input.amount);
      if (balance.lte('0.0005')) throw AppError.conflict('This is already paid in full.');
      if (amount.gt(balance.plus('0.0005'))) {
        throw AppError.conflict(`That is more than what is still owed (${balance.toFixed(3)} ${currency}).`);
      }
      const created = await tx.payment.create({
        data: {
          campaignId,
          ...target,
          amount,
          currency,
          paidAt: input.paidAt ?? new Date(),
          method: input.method,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          receiptId: input.receiptAttachmentId ?? null,
          createdById: actor.id,
        },
      });
      await syncPaidState(tx, target);
      return created;
    });

    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { brandId: true } });
    await logActivity(ctx, {
      type: 'COST_UPDATED',
      message: `${actor.name} recorded a payment of ${payment.amount.toFixed(3)} ${payment.currency} to ${who}.`,
      brandId: campaign.brandId,
      campaignId,
      meta: { paymentId: payment.id },
    });
    return get(payment.id);
  }

  async function voidPayment(id: string, reason: string): Promise<PaymentDTO> {
    const actor = await requireCapability(ctx, 'FINANCE_MANAGE');
    const p = await prisma.payment.findUnique({
      where: { id },
      select: { campaignId: true, campaignInfluencerId: true, expenseId: true, voidedAt: true, amount: true, currency: true },
    });
    if (!p) throw AppError.notFound('Payment');
    const campaign = await assertCampaignInScope(p.campaignId);
    if (p.voidedAt) throw AppError.conflict('This payment is already voided.');
    const target: PaymentTarget = p.campaignInfluencerId
      ? { campaignInfluencerId: p.campaignInfluencerId }
      : { expenseId: p.expenseId! };
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
      await syncPaidState(tx, target);
    });
    await logActivity(ctx, {
      type: 'COST_UPDATED',
      message: `${actor.name} voided a payment of ${p.amount.toFixed(3)} ${p.currency}: ${reason}`,
      brandId: campaign.brandId,
      campaignId: p.campaignId,
      meta: { paymentId: id },
    });
    return get(id);
  }

  async function list(query: PaymentsQuery): Promise<PaymentsPageDTO> {
    await requireCapability(ctx, 'FINANCE_VIEW');
    const campaign: Prisma.CampaignWhereInput = { ...(await brandWhere()) };
    if (query.brandId) campaign.brandId = query.brandId;
    const where: Prisma.PaymentWhereInput = {
      campaign,
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.campaignInfluencerId ? { campaignInfluencerId: query.campaignInfluencerId } : {}),
      ...(query.expenseId ? { expenseId: query.expenseId } : {}),
      ...(query.includeVoided ? {} : { voidedAt: null }),
    };
    // A brand filter outside the reader's scope must not widen it.
    if (query.brandId && isBrandOutOfScope(await scopedBrandIds(ctx), query.brandId)) where.campaignId = '__none__';
    if (query.from || query.to) where.paidAt = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    const and: Prisma.PaymentWhereInput[] = [];
    if (query.influencerId) {
      and.push({
        OR: [
          { campaignInfluencer: { influencerId: query.influencerId } },
          { expense: { campaignInfluencer: { influencerId: query.influencerId } } },
        ],
      });
    }
    if (query.q) {
      and.push({
        OR: [
          { campaign: { name: contains(query.q) } },
          { campaignInfluencer: { influencer: { displayName: contains(query.q) } } },
          { expense: { label: contains(query.q) } },
          { reference: contains(query.q) },
        ],
      });
    }
    if (and.length) where.AND = and;

    const [total, rows, live] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        include: paymentInclude,
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.payment.findMany({ where: { ...where, voidedAt: null }, select: { currency: true, amount: true } }),
    ]);
    return {
      data: await Promise.all(rows.map(toPaymentDTO)),
      pagination: buildOffsetPagination(query.page, query.pageSize, total),
      totals: sumByCurrency(live),
    };
  }

  /** Every creator fee and expense with money still owed, oldest due first. */
  async function payables(query: PayablesQuery): Promise<PayablesPageDTO> {
    await requireCapability(ctx, 'FINANCE_VIEW');
    const campaign: Prisma.CampaignWhereInput = { ...(await brandWhere()) };
    if (query.brandId) {
      if (isBrandOutOfScope(await scopedBrandIds(ctx), query.brandId)) {
        return { data: [], pagination: buildOffsetPagination(query.page, query.pageSize, 0), totals: [] };
      }
      campaign.brandId = query.brandId;
    }
    if (query.campaignId) campaign.id = query.campaignId;
    const campaignSelect = { select: { id: true, name: true, currency: true, brandId: true, brand: { select: { name: true } } } };

    const [fees, expenses] = await Promise.all([
      query.kind === 'EXPENSE'
        ? []
        : prisma.campaignInfluencer.findMany({
            where: {
              campaign,
              dealType: { in: [...PAID_DEALS] },
              agreedCost: { gt: 0 },
              paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
              participationStatus: { notIn: [...ENDED_PARTICIPATION] },
              ...(query.influencerId ? { influencerId: query.influencerId } : {}),
              ...(query.q
                ? { OR: [{ campaign: { name: contains(query.q) } }, { influencer: { displayName: contains(query.q) } }] }
                : {}),
            },
            select: {
              id: true,
              agreedCost: true,
              currency: true,
              paymentStatus: true,
              paidAmount: true,
              expectedPublishAt: true,
              createdAt: true,
              influencerId: true,
              influencer: { select: { displayName: true } },
              campaign: campaignSelect,
            },
          }),
      query.kind === 'FEE'
        ? []
        : prisma.campaignExpense.findMany({
            where: {
              campaign,
              deletedAt: null,
              amount: { gt: 0 },
              paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
              ...(query.influencerId ? { campaignInfluencer: { influencerId: query.influencerId } } : {}),
              ...(query.q
                ? {
                    OR: [
                      { campaign: { name: contains(query.q) } },
                      { label: contains(query.q) },
                      { campaignInfluencer: { influencer: { displayName: contains(query.q) } } },
                    ],
                  }
                : {}),
            },
            select: {
              id: true,
              type: true,
              label: true,
              amount: true,
              currency: true,
              paymentStatus: true,
              paidAmount: true,
              incurredAt: true,
              createdAt: true,
              campaignInfluencerId: true,
              campaignInfluencer: {
                select: { influencerId: true, dealType: true, agreedCost: true, influencer: { select: { displayName: true } } },
              },
              campaign: campaignSelect,
            },
          }),
    ]);

    const ledger = await prisma.payment.groupBy({
      by: ['campaignInfluencerId', 'expenseId'],
      where: {
        voidedAt: null,
        OR: [{ campaignInfluencerId: { in: fees.map((f) => f.id) } }, { expenseId: { in: expenses.map((e) => e.id) } }],
      },
      _count: { _all: true },
      _max: { paidAt: true },
    });
    const ledgerOf = (key: string) =>
      ledger.find((l) => l.campaignInfluencerId === key || l.expenseId === key) ?? null;

    const rows: (PayableDTO & { sortAt: number })[] = [];
    for (const f of fees) {
      const amount = f.agreedCost!;
      const { paid, unpaid } = splitPayment(amount, f.paymentStatus, f.paidAmount);
      if (unpaid.lte(0)) continue;
      const l = ledgerOf(f.id);
      rows.push({
        kind: 'FEE',
        id: f.id,
        campaignId: f.campaign.id,
        campaignName: f.campaign.name,
        brandId: f.campaign.brandId,
        brandName: f.campaign.brand.name,
        influencerId: f.influencerId,
        influencerName: f.influencer.displayName,
        expenseType: null,
        label: null,
        amount: moneyNumberOr0(amount),
        paid: moneyNumberOr0(paid),
        owed: moneyNumberOr0(unpaid),
        currency: f.currency ?? f.campaign.currency,
        paymentStatus: f.paymentStatus,
        dueAt: iso(f.expectedPublishAt),
        lastPaidAt: iso(l?._max.paidAt ?? null),
        paymentsCount: l?._count._all ?? 0,
        sortAt: (f.expectedPublishAt ?? f.createdAt).getTime(),
      });
    }
    for (const e of expenses) {
      // An INFLUENCER_FEE expense that repeats the roster fee is owed once, on the roster.
      const ci = e.campaignInfluencer;
      if (e.type === 'INFLUENCER_FEE' && ci && ci.agreedCost != null && (PAID_DEALS as readonly string[]).includes(ci.dealType)) continue;
      const { paid, unpaid } = splitPayment(e.amount, e.paymentStatus, e.paidAmount);
      if (unpaid.lte(0)) continue;
      const l = ledgerOf(e.id);
      rows.push({
        kind: 'EXPENSE',
        id: e.id,
        campaignId: e.campaign.id,
        campaignName: e.campaign.name,
        brandId: e.campaign.brandId,
        brandName: e.campaign.brand.name,
        influencerId: ci?.influencerId ?? null,
        influencerName: ci?.influencer.displayName ?? null,
        expenseType: e.type,
        label: e.label,
        amount: moneyNumberOr0(e.amount),
        paid: moneyNumberOr0(paid),
        owed: moneyNumberOr0(unpaid),
        currency: e.currency,
        paymentStatus: e.paymentStatus,
        dueAt: iso(e.incurredAt),
        lastPaidAt: iso(l?._max.paidAt ?? null),
        paymentsCount: l?._count._all ?? 0,
        sortAt: (e.incurredAt ?? e.createdAt).getTime(),
      });
    }

    rows.sort((a, b) => a.sortAt - b.sortAt || a.campaignName.localeCompare(b.campaignName));
    const start = (query.page - 1) * query.pageSize;
    return {
      data: rows.slice(start, start + query.pageSize).map(({ sortAt: _sortAt, ...r }) => r),
      pagination: buildOffsetPagination(query.page, query.pageSize, rows.length),
      totals: sumByCurrency(rows.map((r) => ({ currency: r.currency, amount: r.owed }))),
    };
  }

  return {
    recordForFee: (campaignInfluencerId: string, input: PaymentCreate) => record({ campaignInfluencerId }, input),
    recordForExpense: (expenseId: string, input: PaymentCreate) => record({ expenseId }, input),
    void: voidPayment,
    get: async (id: string) => {
      await requireCapability(ctx, 'FINANCE_VIEW');
      const p = await prisma.payment.findUnique({ where: { id }, select: { campaignId: true } });
      if (!p) throw AppError.notFound('Payment');
      await assertCampaignInScope(p.campaignId);
      return get(id);
    },
    list,
    payables,
  };
}

export type PaymentService = ReturnType<typeof makePaymentService>;
