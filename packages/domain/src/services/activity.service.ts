import { requests, type ActivityDTO, type CursorPage } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { windowArgs, windowPage } from '../lib/cursor';
import { toActivityDTO } from '../lib/mappers';
import { scopedBrandIds } from '../lib/scope';

type ActivityFilter = z.infer<typeof requests.activityFilterSchema>;

const activityInclude = {
  actor: { select: { name: true } },
} satisfies Prisma.ActivityLogInclude;

/**
 * Human-readable activity feed (spec §32) — a chronological, cursor-paginated
 * log of meaningful changes, optionally scoped to a brand, campaign or
 * influencer.
 */
export function makeActivityService(ctx: DomainContext) {
  const { prisma } = ctx;

  function buildWhere(filter: ActivityFilter): Prisma.ActivityLogWhereInput {
    const and: Prisma.ActivityLogWhereInput[] = [];
    if (filter.brandId) and.push({ brandId: filter.brandId });
    if (filter.campaignId) and.push({ campaignId: filter.campaignId });
    if (filter.influencerId) and.push({ influencerId: filter.influencerId });
    // A real ActivityLog column — content.service.ts's create/associate/
    // status-change logActivity() calls all set it directly.
    if (filter.publishedContentId) and.push({ publishedContentId: filter.publishedContentId });
    // Shipments aren't one of ActivityLog's first-class relations, so every
    // shipment-related logActivity() call (shipment.service.ts,
    // logistics-issue.service.ts) records `meta.shipmentId` instead — filter
    // that JSON path rather than a dedicated column.
    if (filter.shipmentId) and.push({ meta: { path: ['shipmentId'], equals: filter.shipmentId } });
    return and.length ? { AND: and } : {};
  }

  async function feed(filter: ActivityFilter): Promise<CursorPage<ActivityDTO>> {
    // A user limited to some brands sees only their brands' activity: rows
    // tagged with one of those brands, or untagged rows whose campaign (if
    // any) is one of theirs.
    const brandScope = await scopedBrandIds(ctx);
    const where: Prisma.ActivityLogWhereInput = brandScope
      ? {
          AND: [
            buildWhere(filter),
            {
              OR: [
                { brandId: { in: brandScope } },
                { brandId: null, OR: [{ campaignId: null }, { campaign: { brandId: { in: brandScope } } }] },
              ],
            },
          ],
        }
      : buildWhere(filter);
    const [rows, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        include: activityInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...windowArgs(filter),
      }),
      filter.page ? prisma.activityLog.count({ where }) : null,
    ]);

    const page = windowPage(rows, filter, total);
    return { ...page, data: page.data.map(toActivityDTO) };
  }

  return { feed };
}

export type ActivityService = ReturnType<typeof makeActivityService>;
