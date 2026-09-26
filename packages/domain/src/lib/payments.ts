import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireCapability } from './authz';
import { toDecimal, type MoneyInput } from './money';
import { PAID_DEALS } from './spend';

/**
 * The payment ledger (P2.3) is the record of what was paid. The paid amount,
 * payment status and paid date on a roster row (a creator's fee) or an
 * expense are derived from it, so every existing money rule (spend.ts) keeps
 * reading those two fields and gets the ledger's answer.
 *
 * A row nobody has ever recorded a payment against keeps whatever status it
 * was given (e.g. "not applicable" for a gifted deal, or an old part payment
 * of unknown amount) — the ledger takes over from its first payment.
 */

export type PaymentTarget = { campaignInfluencerId: string } | { expenseId: string };
type Db = Prisma.TransactionClient;

const zero = () => new Prisma.Decimal(0);
/** Amounts are stored to 3 decimals (fils); anything under half a fil is rounding. */
const EPSILON = new Prisma.Decimal('0.0005');

function targetWhere(target: PaymentTarget) {
  return 'campaignInfluencerId' in target
    ? { campaignInfluencerId: target.campaignInfluencerId }
    : { expenseId: target.expenseId };
}

/** What has been paid so far (voided payments left out), and whether the ledger was ever used. */
export async function ledgerTotals(
  db: Db,
  target: PaymentTarget,
): Promise<{ paid: Prisma.Decimal; lastPaidAt: Date | null; count: number; everUsed: boolean }> {
  const where = targetWhere(target);
  const [live, everUsed] = await Promise.all([
    db.payment.findMany({ where: { ...where, voidedAt: null }, select: { amount: true, paidAt: true } }),
    db.payment.count({ where }),
  ]);
  let paid = zero();
  let lastPaidAt: Date | null = null;
  for (const p of live) {
    paid = paid.plus(p.amount);
    if (!lastPaidAt || p.paidAt > lastPaidAt) lastPaidAt = p.paidAt;
  }
  return { paid, lastPaidAt, count: live.length, everUsed: everUsed > 0 };
}

/** The whole amount that is owed, and whether it can be paid at all. */
async function amountDue(
  db: Db,
  target: PaymentTarget,
): Promise<{ full: Prisma.Decimal | null; payable: boolean; currency: string; campaignId: string }> {
  if ('campaignInfluencerId' in target) {
    const ci = await db.campaignInfluencer.findUnique({
      where: { id: target.campaignInfluencerId },
      select: { dealType: true, agreedCost: true, currency: true, campaignId: true, campaign: { select: { currency: true } } },
    });
    if (!ci) throw AppError.notFound('Campaign influencer');
    const full = toDecimal(ci.agreedCost);
    return {
      full,
      payable: (PAID_DEALS as readonly string[]).includes(ci.dealType) && !!full && full.gt(0),
      currency: ci.currency ?? ci.campaign.currency,
      campaignId: ci.campaignId,
    };
  }
  const e = await db.campaignExpense.findUnique({
    where: { id: target.expenseId },
    select: { amount: true, currency: true, campaignId: true },
  });
  if (!e) throw AppError.notFound('Expense');
  return { full: e.amount, payable: e.amount.gt(0), currency: e.currency, campaignId: e.campaignId };
}

/** Re-derive the paid amount, status and date from the ledger. */
export async function syncPaidState(db: Db, target: PaymentTarget): Promise<void> {
  const totals = await ledgerTotals(db, target);
  const { full, payable } = await amountDue(db, target);
  if (!totals.everUsed) {
    // Nothing recorded yet: only "unpaid" vs "not applicable" follows the
    // deal / amount (a paid deal with a fee is owed, a gifted one isn't). An
    // older paid or part-paid status with no ledger behind it is left as is.
    const current =
      'campaignInfluencerId' in target
        ? (await db.campaignInfluencer.findUnique({ where: { id: target.campaignInfluencerId }, select: { paymentStatus: true } }))?.paymentStatus
        : (await db.campaignExpense.findUnique({ where: { id: target.expenseId }, select: { paymentStatus: true } }))?.paymentStatus;
    if (current === 'UNPAID' || current === 'NOT_APPLICABLE') {
      const next = payable ? 'UNPAID' : 'NOT_APPLICABLE';
      if (next !== current) await writeStatus(db, target, next, null, null);
    }
    return;
  }
  const paid = totals.paid;
  let status: 'NOT_APPLICABLE' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  if (paid.lte(EPSILON)) status = payable ? 'UNPAID' : 'NOT_APPLICABLE';
  else if (!full || full.lte(0) || paid.plus(EPSILON).gte(full)) status = 'PAID';
  else status = 'PARTIALLY_PAID';
  const data = {
    paymentStatus: status,
    paidAmount: paid.gt(EPSILON) ? paid : null,
    paidAt: paid.gt(EPSILON) ? totals.lastPaidAt : null,
  };
  if ('campaignInfluencerId' in target) {
    await db.campaignInfluencer.update({ where: { id: target.campaignInfluencerId }, data });
  } else {
    await db.campaignExpense.update({ where: { id: target.expenseId }, data });
  }
}

/** How much is still owed on a fee or expense (never below zero). */
export async function balanceOf(db: Db, target: PaymentTarget): Promise<{ balance: Prisma.Decimal; currency: string; payable: boolean; campaignId: string }> {
  const [{ full, payable, currency, campaignId }, { paid }] = await Promise.all([amountDue(db, target), ledgerTotals(db, target)]);
  const balance = full ? full.minus(paid) : zero();
  return { balance: balance.lt(0) ? zero() : balance, currency, payable, campaignId };
}

export interface LegacyPaymentFields {
  paymentStatus?: string | null;
  paidAmount?: MoneyInput;
  paidAt?: Date | null;
}

/**
 * The older "set the status / paid amount" way of recording a payment (still
 * accepted by the roster and expense endpoints) goes through the ledger: a
 * higher paid total records a payment for the difference; a lower one is
 * refused — money already recorded is taken back by voiding a payment, so
 * the history stays true. With no payment ever recorded, a status that
 * involves no money (unpaid / not applicable, or a part payment of unknown
 * amount) is simply stored.
 */
export async function applyLegacyPaymentFields(
  ctx: DomainContext,
  db: Db,
  target: PaymentTarget,
  input: LegacyPaymentFields,
  note = 'Recorded from a payment status change',
): Promise<void> {
  const touched = input.paymentStatus != null || input.paidAmount !== undefined || input.paidAt !== undefined;
  if (!touched) return;
  const { full, currency, campaignId } = await amountDue(db, target);
  const totals = await ledgerTotals(db, target);

  let wanted: Prisma.Decimal | null;
  const status = input.paymentStatus ?? null;
  if (status === 'PAID') wanted = full && full.gt(0) ? full : null;
  else if (status === 'PARTIALLY_PAID') wanted = toDecimal(input.paidAmount ?? null);
  else if (status === 'UNPAID' || status === 'NOT_APPLICABLE') wanted = zero();
  else wanted = input.paidAmount === undefined ? totals.paid : toDecimal(input.paidAmount) ?? zero();

  if (wanted === null) {
    // Paid in full with no amount on record, or a part payment of unknown
    // amount: nothing to put in the ledger.
    if (totals.everUsed) {
      throw AppError.conflict('Payments are recorded for this. Record a payment with its amount instead.');
    }
    await writeStatus(db, target, status ?? 'UNPAID', null, input.paidAt ?? null);
    return;
  }

  if (wanted.minus(totals.paid).abs().lte(EPSILON)) {
    if (!totals.everUsed && status) await writeStatus(db, target, status, null, null);
    return;
  }
  if (full && full.gt(0) && wanted.gt(full.plus(EPSILON))) {
    throw AppError.conflict(`That is more than the whole amount (${full.toFixed(3)} ${currency}).`);
  }
  if (wanted.lt(totals.paid)) {
    throw AppError.conflict(
      `${totals.paid.toFixed(3)} ${currency} is recorded as paid in the payment history. To lower it, void a payment there.`,
    );
  }
  const actor = await requireCapability(ctx, 'FINANCE_MANAGE');
  await db.payment.create({
    data: {
      campaignId,
      ...targetWhere(target),
      amount: wanted.minus(totals.paid),
      currency,
      paidAt: input.paidAt ?? new Date(),
      method: 'OTHER',
      notes: note,
      createdById: actor.id,
    },
  });
}

async function writeStatus(db: Db, target: PaymentTarget, status: string, paidAmount: Prisma.Decimal | null, paidAt: Date | null) {
  const data = {
    paymentStatus: status as 'NOT_APPLICABLE' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID',
    paidAmount,
    paidAt,
  };
  if ('campaignInfluencerId' in target) await db.campaignInfluencer.update({ where: { id: target.campaignInfluencerId }, data });
  else await db.campaignExpense.update({ where: { id: target.expenseId }, data });
}
