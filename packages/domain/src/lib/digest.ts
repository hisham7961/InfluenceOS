import { requests, type DigestDTO, type DigestItemDTO, type DigestSectionDTO } from '@influenceos/contracts';
import type { Prisma } from '@influenceos/database';
import { USAGE_RIGHT_EXPIRY_WARNING_DAYS, appRoutes } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { makePaymentService } from '../services/payment.service';
import { hasCapability } from './capabilities';
import { dueWithinWhere, overdueWhere } from './deliverable-rules';
import { scopedBrandIds, scopedCountryCodes } from './scope';

/** Statuses that mean a post is no longer up. */
export const REMOVED_CONTENT_STATUSES = ['REMOVED', 'PRIVATE', 'UNAVAILABLE', 'BROKEN_LINK'] as const;

/**
 * Posts that went down since `since`: the monitor recorded a status change
 * to removed/private/unavailable in that window and the post is still down.
 * (Counting by "last checked" instead would count every post that is still
 * down each time it's re-checked.)
 */
export function removedSinceWhere(since: Date): Prisma.PublishedContentWhereInput {
  return {
    availabilityStatus: { in: [...REMOVED_CONTENT_STATUSES] },
    monitoringEvents: {
      some: { type: 'STATUS_CHANGED', toStatus: { in: [...REMOVED_CONTENT_STATUSES] }, checkedAt: { gte: since } },
    },
  };
}

const SECTION_SIZE = 8;
const DAY = 864e5;

const section = (total: number, items: DigestItemDTO[]): DigestSectionDTO => ({ total, items });

/**
 * The summary for the actor in `ctx` (P2.6): scoped to their brands and
 * countries. Deadlines and reviews are narrowed to the campaigns and
 * creators they own — when they own any; someone who owns nothing (small
 * teams often don't set owners) sees the whole team's.
 */
export async function buildDigest(ctx: DomainContext, opts: { since: Date; now?: Date }): Promise<DigestDTO> {
  const actor = ctx.actor;
  if (!actor) throw new Error('buildDigest needs a signed-in user.');
  const { prisma } = ctx;
  const now = opts.now ?? new Date();
  const [brands, countries] = await Promise.all([scopedBrandIds(ctx), scopedCountryCodes(ctx)]);

  const [ownedCampaigns, ownedCreators] = await Promise.all([
    prisma.campaign.count({ where: { ownerId: actor.id } }),
    prisma.influencer.count({ where: { ownerId: actor.id } }),
  ]);
  const onlyMine = ownedCampaigns + ownedCreators > 0;

  const deliverableScope: Prisma.DeliverableWhereInput[] = [];
  if (brands) deliverableScope.push({ campaignInfluencer: { campaign: { brandId: { in: brands } } } });
  if (countries) deliverableScope.push({ campaignInfluencer: { influencer: { countryCode: { in: countries } } } });
  if (onlyMine) {
    deliverableScope.push({
      OR: [
        { campaignInfluencer: { campaign: { ownerId: actor.id } } },
        { campaignInfluencer: { influencer: { ownerId: actor.id } } },
      ],
    });
  }
  const deliverableSelect = {
    id: true,
    type: true,
    platform: true,
    dueDate: true,
    campaignInfluencer: {
      select: {
        campaignId: true,
        campaign: { select: { name: true, brand: { select: { name: true } } } },
        influencer: { select: { displayName: true } },
      },
    },
  } as const;
  type DeliverableRow = Prisma.DeliverableGetPayload<{ select: typeof deliverableSelect }>;
  const deliverableItem = (d: DeliverableRow): DigestItemDTO => ({
    id: d.id,
    link: appRoutes.campaign(d.campaignInfluencer.campaignId, 'deliverables'),
    influencerName: d.campaignInfluencer.influencer.displayName,
    campaignName: d.campaignInfluencer.campaign.name,
    brandName: d.campaignInfluencer.campaign.brand.name,
    kind: d.type,
    platform: d.platform,
    at: d.dueDate?.toISOString() ?? null,
  });

  const overdueWhereAll: Prisma.DeliverableWhereInput = { AND: [overdueWhere(now), ...deliverableScope] };
  const dueSoonWhere: Prisma.DeliverableWhereInput = { AND: [dueWithinWhere(1, now), ...deliverableScope] };

  const submissionWhere: Prisma.DeliverableSubmissionWhereInput = {
    status: 'IN_REVIEW',
    deliverable: deliverableScope.length ? { AND: deliverableScope } : {},
  };

  const contentScope: Prisma.PublishedContentWhereInput[] = [removedSinceWhere(opts.since)];
  if (brands) contentScope.push({ brandId: { in: brands } });
  if (countries) contentScope.push({ influencer: { countryCode: { in: countries } } });
  const removedWhere: Prisma.PublishedContentWhereInput = { AND: contentScope };

  const rightsScope: Prisma.UsageRightWhereInput[] = [
    { status: 'ACTIVE', expiresAt: { gte: now, lte: new Date(now.getTime() + USAGE_RIGHT_EXPIRY_WARNING_DAYS * DAY) } },
  ];
  if (brands) rightsScope.push({ brandId: { in: brands } });
  if (countries) rightsScope.push({ OR: [{ influencerId: null }, { influencer: { countryCode: { in: countries } } }] });
  const rightsWhere: Prisma.UsageRightWhereInput = { AND: rightsScope };

  const [overdueRows, overdueTotal, dueRows, dueTotal, reviewRows, reviewTotal, removedRows, removedTotal, rightRows, rightTotal] =
    await Promise.all([
      prisma.deliverable.findMany({ where: overdueWhereAll, select: deliverableSelect, orderBy: { dueDate: 'asc' }, take: SECTION_SIZE }),
      prisma.deliverable.count({ where: overdueWhereAll }),
      prisma.deliverable.findMany({ where: dueSoonWhere, select: deliverableSelect, orderBy: { dueDate: 'asc' }, take: SECTION_SIZE }),
      prisma.deliverable.count({ where: dueSoonWhere }),
      prisma.deliverableSubmission.findMany({
        where: submissionWhere,
        select: { id: true, createdAt: true, deliverable: { select: deliverableSelect } },
        orderBy: { createdAt: 'asc' },
        take: SECTION_SIZE,
      }),
      prisma.deliverableSubmission.count({ where: submissionWhere }),
      prisma.publishedContent.findMany({
        where: removedWhere,
        select: {
          id: true,
          platform: true,
          availabilityStatus: true,
          influencer: { select: { displayName: true } },
          brand: { select: { name: true } },
          campaign: { select: { name: true } },
          monitoringEvents: {
            where: { type: 'STATUS_CHANGED', toStatus: { in: [...REMOVED_CONTENT_STATUSES] } },
            orderBy: { checkedAt: 'desc' },
            take: 1,
            select: { checkedAt: true },
          },
        },
        orderBy: { lastCheckedAt: 'desc' },
        take: SECTION_SIZE,
      }),
      prisma.publishedContent.count({ where: removedWhere }),
      prisma.usageRight.findMany({
        where: rightsWhere,
        select: {
          id: true,
          brandId: true,
          usageType: true,
          expiresAt: true,
          brand: { select: { name: true } },
          influencer: { select: { displayName: true } },
        },
        orderBy: { expiresAt: 'asc' },
        take: SECTION_SIZE,
      }),
      prisma.usageRight.count({ where: rightsWhere }),
    ]);

  let unpaid: DigestDTO['unpaid'] = null;
  if (await hasCapability(ctx, 'FINANCE_VIEW')) {
    const page = await makePaymentService(ctx).payables(requests.payablesQuerySchema.parse({ pageSize: 1 }));
    if (page.pagination.total > 0) {
      unpaid = { count: page.pagination.total, totals: page.totals.map((t) => ({ currency: t.currency, amount: String(t.amount) })) };
    }
  }

  const digest: DigestDTO = {
    generatedAt: now.toISOString(),
    since: opts.since.toISOString(),
    onlyMine,
    overdue: section(overdueTotal, overdueRows.map(deliverableItem)),
    dueSoon: section(dueTotal, dueRows.map(deliverableItem)),
    reviews: section(
      reviewTotal,
      reviewRows.map((s) => ({
        ...deliverableItem(s.deliverable),
        id: s.id,
        link: appRoutes.campaign(s.deliverable.campaignInfluencer.campaignId, 'submissions'),
        at: s.createdAt.toISOString(),
      })),
    ),
    removed: section(
      removedTotal,
      removedRows.map((c) => ({
        id: c.id,
        link: appRoutes.content(c.id),
        influencerName: c.influencer?.displayName ?? null,
        campaignName: c.campaign?.name ?? null,
        brandName: c.brand?.name ?? null,
        kind: c.availabilityStatus,
        platform: c.platform,
        at: c.monitoringEvents[0]?.checkedAt.toISOString() ?? null,
      })),
    ),
    expiringRights: section(
      rightTotal,
      rightRows.map((r) => ({
        id: r.id,
        link: appRoutes.brandUsageRights(r.brandId),
        influencerName: r.influencer?.displayName ?? null,
        campaignName: null,
        brandName: r.brand.name,
        kind: r.usageType,
        platform: null,
        at: r.expiresAt?.toISOString() ?? null,
      })),
    ),
    unpaid,
    isEmpty: false,
  };
  // Money owed on its own doesn't make a summary worth sending — it rides
  // along when something else needs attention.
  digest.isEmpty =
    !digest.overdue.total && !digest.dueSoon.total && !digest.reviews.total && !digest.removed.total && !digest.expiringRights.total;
  return digest;
}
