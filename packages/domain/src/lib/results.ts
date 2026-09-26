import type { CurrencyTotalDTO, PeriodKpisDTO, TrendBucket, TrendsDTO } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import {
  addBusinessDays,
  bucketStartKey,
  bucketStarts,
  businessDateKey,
  overdueAfter,
  startOfBusinessDay,
} from '@influenceos/shared';
import type { DomainContext } from '../context';
import { deliveredWhere } from './deliverable-rules';
import { loadPostMetrics, postedBetween, sumKnown } from './post-metrics';

/**
 * Results over time (P2.7): what went up, how it did, what was delivered and
 * what was paid, for a period or bucketed by week/month — Kuwait days
 * throughout. Payments come from the ledger (P2.3), the record of money
 * actually paid.
 */
export interface ResultsScope {
  /** null = every brand. */
  brandIds: string[] | null;
  campaignId?: string;
  influencerId?: string;
}

function postScope(s: ResultsScope): Prisma.PublishedContentWhereInput[] {
  const out: Prisma.PublishedContentWhereInput[] = [];
  if (s.brandIds) out.push({ brandId: { in: s.brandIds } });
  if (s.campaignId) out.push({ campaignId: s.campaignId });
  if (s.influencerId) out.push({ influencerId: s.influencerId });
  return out;
}

function deliverableScope(s: ResultsScope): Prisma.DeliverableWhereInput[] {
  const out: Prisma.DeliverableWhereInput[] = [];
  if (s.brandIds) out.push({ campaignInfluencer: { campaign: { brandId: { in: s.brandIds } } } });
  if (s.campaignId) out.push({ campaignInfluencer: { campaignId: s.campaignId } });
  if (s.influencerId) out.push({ campaignInfluencer: { influencerId: s.influencerId } });
  return out;
}

function paymentScope(s: ResultsScope): Prisma.PaymentWhereInput[] {
  const out: Prisma.PaymentWhereInput[] = [{ voidedAt: null }];
  if (s.brandIds) out.push({ campaign: { brandId: { in: s.brandIds } } });
  if (s.campaignId) out.push({ campaignId: s.campaignId });
  if (s.influencerId) out.push({ campaignInfluencer: { influencerId: s.influencerId } });
  return out;
}

function saleScope(s: ResultsScope): Prisma.SaleWhereInput[] {
  const out: Prisma.SaleWhereInput[] = [];
  if (s.brandIds) out.push({ brandId: { in: s.brandIds } });
  if (s.campaignId) out.push({ campaignId: s.campaignId });
  if (s.influencerId) out.push({ influencerId: s.influencerId });
  return out;
}

function campaignScope(s: ResultsScope): Prisma.CampaignWhereInput[] {
  const out: Prisma.CampaignWhereInput[] = [{ status: { notIn: ['DRAFT', 'CANCELLED'] } }];
  if (s.brandIds) out.push({ brandId: { in: s.brandIds } });
  if (s.campaignId) out.push({ id: s.campaignId });
  if (s.influencerId) out.push({ campaignInfluencers: { some: { influencerId: s.influencerId } } });
  return out;
}

const round3 = (d: Prisma.Decimal) => Number(d.toFixed(3));

function currencyTotals(rows: { currency: string; amount: Prisma.Decimal | null }[]): CurrencyTotalDTO[] {
  const by = new Map<string, Prisma.Decimal>();
  for (const r of rows) {
    if (!r.amount) continue;
    by.set(r.currency, (by.get(r.currency) ?? new Prisma.Decimal(0)).plus(r.amount));
  }
  return [...by.entries()]
    .map(([currency, amount]) => ({ currency, amount: round3(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

function costPerView(paid: CurrencyTotalDTO[] | null, views: number | null): { currency: string; value: number } | null {
  if (!paid || paid.length !== 1 || !views) return null;
  return { currency: paid[0]!.currency, value: Math.round((paid[0]!.amount / views) * 1_000_000) / 1_000_000 };
}

/** Results for one period [from, to). */
export async function periodKpis(
  ctx: DomainContext,
  scope: ResultsScope,
  from: Date,
  to: Date,
  canSeeMoney: boolean,
): Promise<PeriodKpisDTO> {
  const { prisma } = ctx;
  const [posts, delivered, campaignsStarted, payments, sales] = await Promise.all([
    loadPostMetrics(prisma, { AND: [postedBetween(from, to), ...postScope(scope)] }),
    prisma.deliverable.findMany({
      where: { AND: [deliveredWhere, { publishedAt: { gte: from, lt: to } }, ...deliverableScope(scope)] },
      select: { dueDate: true, publishedAt: true },
    }),
    prisma.campaign.count({ where: { AND: [{ startDate: { gte: from, lt: to } }, ...campaignScope(scope)] } }),
    canSeeMoney
      ? prisma.payment.findMany({
          where: { AND: [{ paidAt: { gte: from, lt: to } }, ...paymentScope(scope)] },
          select: { currency: true, amount: true },
        })
      : Promise.resolve(null),
    // Sales credited through promo codes and tracking links (P3.1).
    prisma.sale.groupBy({
      by: ['currency'],
      where: { AND: [{ occurredAt: { gte: from, lt: to } }, ...saleScope(scope)] },
      _sum: { amount: true, orders: true },
    }),
  ]);

  const views = sumKnown(posts.map((p) => p.views));
  const engagements = sumKnown(posts.map((p) => p.engagements));
  const judged = delivered.filter((d) => d.dueDate && d.publishedAt);
  const onTime = judged.filter((d) => d.publishedAt! < overdueAfter(d.dueDate!)).length;
  const paid = payments ? currencyTotals(payments) : null;

  return {
    postsPublished: posts.length,
    views,
    engagements,
    engagementRate: views && engagements != null ? Math.round((engagements / views) * 10_000) / 100 : null,
    deliverablesDelivered: delivered.length,
    onTimeRate: judged.length ? Math.round((onTime / judged.length) * 1000) / 1000 : null,
    activeCreators: new Set(posts.map((p) => p.influencerId).filter(Boolean)).size,
    campaignsStarted,
    paid,
    costPerView: costPerView(paid, views),
    orders: sales.reduce((n, g) => n + (g._sum.orders ?? 0), 0),
    revenue: currencyTotals(sales.map((g) => ({ currency: g.currency, amount: g._sum.amount }))),
  };
}

/** How far back trends go when no dates are given: the last 12 buckets. */
export function defaultTrendRange(bucket: TrendBucket, now: Date = new Date()): { fromKey: string; toKey: string } {
  const toKey = businessDateKey(now);
  if (bucket === 'week') return { fromKey: addBusinessDays(bucketStartKey(toKey, 'week'), -7 * 11), toKey };
  const [y, m] = toKey.split('-').map(Number) as [number, number];
  return { fromKey: new Date(Date.UTC(y, m - 1 - 11, 1)).toISOString().slice(0, 10), toKey };
}

/** Results bucketed by week (Sunday–Saturday) or month, Kuwait days. */
export async function trendPoints(
  ctx: DomainContext,
  scope: ResultsScope,
  fromKey: string,
  toKey: string,
  bucket: TrendBucket,
  canSeeMoney: boolean,
): Promise<TrendsDTO> {
  const { prisma } = ctx;
  const starts = bucketStarts(fromKey, toKey, bucket);
  const from = startOfBusinessDay(starts[0] ?? fromKey);
  const to = startOfBusinessDay(addBusinessDays(toKey, 1));

  const [posts, delivered, payments] = await Promise.all([
    loadPostMetrics(prisma, { AND: [postedBetween(from, to), ...postScope(scope)] }),
    prisma.deliverable.findMany({
      where: { AND: [deliveredWhere, { publishedAt: { gte: from, lt: to } }, ...deliverableScope(scope)] },
      select: { publishedAt: true },
    }),
    canSeeMoney
      ? prisma.payment.findMany({
          where: { AND: [{ paidAt: { gte: from, lt: to } }, ...paymentScope(scope)] },
          select: { currency: true, amount: true, paidAt: true },
        })
      : Promise.resolve(null),
  ]);

  type Acc = { posts: number; views: (number | null)[]; engagements: (number | null)[]; delivered: number; paid: { currency: string; amount: Prisma.Decimal }[] };
  const acc = new Map<string, Acc>(starts.map((k) => [k, { posts: 0, views: [], engagements: [], delivered: 0, paid: [] }]));
  const at = (day: string) => acc.get(bucketStartKey(day, bucket));

  for (const p of posts) {
    const a = at(p.day);
    if (!a) continue;
    a.posts += 1;
    a.views.push(p.views);
    a.engagements.push(p.engagements);
  }
  for (const d of delivered) {
    const a = d.publishedAt ? at(businessDateKey(d.publishedAt)) : undefined;
    if (a) a.delivered += 1;
  }
  for (const p of payments ?? []) {
    const a = at(businessDateKey(p.paidAt));
    if (a) a.paid.push({ currency: p.currency, amount: p.amount });
  }

  const currencyRank = payments ? currencyTotals(payments).map((c) => c.currency) : [];
  return {
    bucket,
    from: starts[0] ?? fromKey,
    to: toKey,
    currencies: currencyRank,
    points: starts.map((start) => {
      const a = acc.get(start)!;
      return {
        start,
        postsPublished: a.posts,
        views: sumKnown(a.views),
        engagements: sumKnown(a.engagements),
        deliverablesDelivered: a.delivered,
        paid: payments ? currencyTotals(a.paid) : null,
      };
    }),
  };
}
