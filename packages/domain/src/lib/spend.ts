import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { toDecimal, type MoneyInput } from './money';

/**
 * The one set of money rules for campaign spend and payments, used by the
 * campaign cost summary, Mission Control, the exec page, brand pages,
 * reports and creator pages (they used to add things up six different ways).
 *
 * - A creator's fee is the roster's agreed cost on a paid deal. A creator who
 *   declined or dropped out adds only what was actually paid to them.
 * - An INFLUENCER_FEE expense for a creator whose agreed fee is already on
 *   the roster repeats that fee and is not counted again (new ones are
 *   refused when entered — see expense.service).
 * - Spend = creator fees + every other expense except gift products (gift
 *   value is reported separately).
 * - Paid / unpaid cover everything owed: fees, expenses and gift purchases.
 *   Paid in full counts in full, a part payment counts what was recorded as
 *   paid, "not applicable" is neither.
 * Exact Decimal arithmetic throughout (see money.ts).
 */

export const PAID_DEALS = ['PAID', 'PAID_PLUS_GIFTED'] as const;
/** Participations that ended without the work. */
export const ENDED_PARTICIPATION = ['DECLINED', 'DROPPED'] as const;

const zero = () => new Prisma.Decimal(0);

/** Paid / still-owed parts of an amount by payment status. */
export function splitPayment(
  amount: Prisma.Decimal,
  status: string,
  paidAmount: MoneyInput,
): { paid: Prisma.Decimal; unpaid: Prisma.Decimal } {
  if (status === 'PAID') return { paid: amount, unpaid: zero() };
  if (status === 'UNPAID') return { paid: zero(), unpaid: amount };
  if (status === 'PARTIALLY_PAID') {
    let paid = toDecimal(paidAmount) ?? zero();
    if (paid.lt(0)) paid = zero();
    if (paid.gt(amount)) paid = amount;
    return { paid, unpaid: amount.minus(paid) };
  }
  return { paid: zero(), unpaid: zero() }; // NOT_APPLICABLE
}

export type ParticipationMoneyRow = {
  id?: string;
  dealType: string;
  agreedCost: MoneyInput;
  giftedProductValue?: MoneyInput;
  participationStatus?: string | null;
  paymentStatus: string;
  paidAmount: MoneyInput;
};

export type ExpenseMoneyRow = {
  type: string;
  amount: MoneyInput;
  paymentStatus: string;
  paidAmount: MoneyInput;
  campaignInfluencerId?: string | null;
};

/** What one roster row adds to spend, and how much of that is paid / still owed. */
export function participationMoney(ci: ParticipationMoneyRow): {
  fee: Prisma.Decimal;
  paid: Prisma.Decimal;
  unpaid: Prisma.Decimal;
} {
  if (!(PAID_DEALS as readonly string[]).includes(ci.dealType)) return { fee: zero(), paid: zero(), unpaid: zero() };
  const agreed = toDecimal(ci.agreedCost) ?? zero();
  const split = splitPayment(agreed, ci.paymentStatus, ci.paidAmount);
  if ((ENDED_PARTICIPATION as readonly string[]).includes(ci.participationStatus ?? '')) {
    return { fee: split.paid, paid: split.paid, unpaid: zero() };
  }
  return { fee: agreed, ...split };
}

/** Roster rows whose fee is already on record as their agreed cost. */
export function rosterFeeIds(cis: ParticipationMoneyRow[]): Set<string> {
  const ids = new Set<string>();
  for (const ci of cis) {
    if (ci.id && ci.agreedCost != null && (PAID_DEALS as readonly string[]).includes(ci.dealType)) ids.add(ci.id);
  }
  return ids;
}

/** An INFLUENCER_FEE expense that repeats a fee already on the roster. */
export function isRepeatedFee(e: ExpenseMoneyRow, rosterFees: Set<string>): boolean {
  return e.type === 'INFLUENCER_FEE' && !!e.campaignInfluencerId && rosterFees.has(e.campaignInfluencerId);
}

export interface CampaignMoney {
  influencerFees: Prisma.Decimal;
  otherExpenses: Prisma.Decimal;
  giftValue: Prisma.Decimal;
  totalSpend: Prisma.Decimal;
  paid: Prisma.Decimal;
  unpaid: Prisma.Decimal;
}

/** One campaign's money from its roster rows and expenses (already fetched). */
export function campaignMoney(cis: ParticipationMoneyRow[], expenses: ExpenseMoneyRow[]): CampaignMoney {
  let influencerFees = zero();
  let otherExpenses = zero();
  let giftValue = zero();
  let paid = zero();
  let unpaid = zero();

  for (const ci of cis) {
    const m = participationMoney(ci);
    influencerFees = influencerFees.plus(m.fee);
    paid = paid.plus(m.paid);
    unpaid = unpaid.plus(m.unpaid);
    giftValue = giftValue.plus(toDecimal(ci.giftedProductValue) ?? zero());
  }

  const rosterFees = rosterFeeIds(cis);
  for (const e of expenses) {
    if (isRepeatedFee(e, rosterFees)) continue;
    const amount = toDecimal(e.amount) ?? zero();
    if (e.type === 'GIFT_PRODUCT') giftValue = giftValue.plus(amount);
    else otherExpenses = otherExpenses.plus(amount);
    const split = splitPayment(amount, e.paymentStatus, e.paidAmount);
    paid = paid.plus(split.paid);
    unpaid = unpaid.plus(split.unpaid);
  }

  return { influencerFees, otherExpenses, giftValue, totalSpend: influencerFees.plus(otherExpenses), paid, unpaid };
}

export const EMPTY_CAMPAIGN_MONEY: CampaignMoney = campaignMoney([], []);

/** Money for many campaigns in two queries, keyed by campaign id. */
export async function loadCampaignMoney(
  prisma: DomainContext['prisma'],
  campaignIds: string[],
): Promise<Map<string, CampaignMoney>> {
  const out = new Map<string, CampaignMoney>();
  if (campaignIds.length === 0) return out;
  const [cis, expenses] = await Promise.all([
    prisma.campaignInfluencer.findMany({
      where: { campaignId: { in: campaignIds } },
      select: {
        id: true,
        campaignId: true,
        dealType: true,
        agreedCost: true,
        giftedProductValue: true,
        participationStatus: true,
        paymentStatus: true,
        paidAmount: true,
      },
    }),
    prisma.campaignExpense.findMany({
      where: { campaignId: { in: campaignIds } },
      select: { campaignId: true, campaignInfluencerId: true, type: true, amount: true, paymentStatus: true, paidAmount: true },
    }),
  ]);
  const cisBy = new Map<string, typeof cis>();
  const expBy = new Map<string, typeof expenses>();
  for (const c of cis) (cisBy.get(c.campaignId) ?? cisBy.set(c.campaignId, []).get(c.campaignId)!).push(c);
  for (const e of expenses) (expBy.get(e.campaignId) ?? expBy.set(e.campaignId, []).get(e.campaignId)!).push(e);
  for (const id of campaignIds) out.set(id, campaignMoney(cisBy.get(id) ?? [], expBy.get(id) ?? []));
  return out;
}

/** Sum of a field over many campaigns' money. */
export function sumCampaignMoney(
  moneys: Iterable<CampaignMoney>,
  field: keyof CampaignMoney,
): Prisma.Decimal {
  let total = zero();
  for (const m of moneys) total = total.plus(m[field]);
  return total;
}
