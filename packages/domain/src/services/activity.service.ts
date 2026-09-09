import { requests, type ActivityDTO, type CursorPage } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { toActivityDTO } from '../lib/mappers';

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
    return and.length ? { AND: and } : {};
  }

  async function feed(filter: ActivityFilter): Promise<CursorPage<ActivityDTO>> {
    const where = buildWhere(filter);
    const rows = await prisma.activityLog.findMany({
      where,
      include: activityInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    return {
      data: page.map(toActivityDTO),
      nextCursor,
      hasMore,
    };
  }

  return { feed };
}

export type ActivityService = ReturnType<typeof makeActivityService>;
