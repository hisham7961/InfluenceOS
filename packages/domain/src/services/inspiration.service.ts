import { requests, type InspirationItemDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import { buildEmbed, detectPlatform, resolveContentThumbnail } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor, requireCapability, requireOwnerOrAdmin } from '../lib/authz';
import { isBrandOutOfScope, scopedBrandIds } from '../lib/scope';

type InspirationCreate = z.infer<typeof requests.inspirationCreateSchema>;
type InspirationUpdate = z.infer<typeof requests.inspirationUpdateSchema>;
type InspirationFilter = z.infer<typeof requests.inspirationFilterSchema>;

const inspirationInclude = {
  brand: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
  scriptReference: { select: { id: true, title: true } },
  submittedBy: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.InspirationItemInclude;

type InspirationRow = Prisma.InspirationItemGetPayload<{ include: typeof inspirationInclude }>;

function toDTO(row: InspirationRow): InspirationItemDTO {
  const embed = buildEmbed(row.url, row.platform);
  return {
    id: row.id,
    url: row.url,
    platform: row.platform,
    embed,
    embeddable: !!embed && embed.kind !== 'link-only',
    thumbnailUrl: row.thumbnailUrl,
    title: row.title,
    note: row.note,
    category: row.category,
    tags: row.tags,
    brandId: row.brandId,
    brandName: row.brand?.name ?? null,
    campaignId: row.campaignId,
    campaignName: row.campaign?.name ?? null,
    scriptReferenceId: row.scriptReferenceId,
    scriptReferenceTitle: row.scriptReference?.title ?? null,
    status: row.status,
    pinned: row.pinned,
    submittedById: row.submittedById,
    submittedByName: row.submittedBy?.name ?? null,
    commentCount: row._count.comments,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Trends & Inspiration (Operations Intelligence pass, PART 18-24) — external
 * reference material (a competitor's ad, a trending format, a creative
 * technique) that the team wants to remember and discuss. Deliberately its
 * own model, never PublishedContent: this is not the brand's own posted
 * content and must never leak into content analytics/review counts/Content
 * Command Center. Discussion reuses the SAME Note/Collaboration Layer
 * (`comments Note[]` with `inspirationItemId` set) as everywhere else.
 */
export function makeInspirationService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function assertInScope(brandId: string | null): Promise<void> {
    if (!brandId) return;
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, brandId)) throw AppError.notFound('Brand');
  }

  async function list(filter: InspirationFilter): Promise<{ data: InspirationItemDTO[]; nextCursor: string | null; hasMore: boolean }> {
    const scope = await scopedBrandIds(ctx);
    if (filter.brandId) await assertInScope(filter.brandId);
    const where: Prisma.InspirationItemWhereInput = {
      ...(filter.brandId ? { brandId: filter.brandId } : scope ? { OR: [{ brandId: { in: scope } }, { brandId: null }] } : {}),
      ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.status ? { status: filter.status } : { status: { not: 'ARCHIVED' } }),
      ...(filter.pinned !== undefined ? { pinned: filter.pinned } : {}),
      ...(filter.search
        ? {
            OR: [
              { title: { contains: filter.search, mode: 'insensitive' } },
              { note: { contains: filter.search, mode: 'insensitive' } },
              { tags: { has: filter.search } },
            ],
          }
        : {}),
    };
    const rows = await prisma.inspirationItem.findMany({
      where,
      include: inspirationInclude,
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > filter.limit;
    const page = rows.slice(0, filter.limit);
    return { data: page.map(toDTO), nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null, hasMore };
  }

  async function get(id: string): Promise<InspirationItemDTO> {
    const row = await prisma.inspirationItem.findUnique({ where: { id }, include: inspirationInclude });
    if (!row) throw AppError.notFound('Inspiration item');
    await assertInScope(row.brandId);
    return toDTO(row);
  }

  async function create(input: InspirationCreate): Promise<InspirationItemDTO> {
    // Capability grants WHAT the actor can do (Security & Authorization
    // Freeze Gate) — this was previously a bare requireActor. CONTENT_MANAGE
    // is the closest analog: Trends/Inspiration items are external reference
    // content and there is no dedicated capability for them. Brand scope
    // (WHERE) is already enforced below via assertInScope.
    const actor = await requireCapability(ctx, 'CONTENT_MANAGE');
    if (input.brandId) await assertInScope(input.brandId);

    // A trend link isn't required to be a known social platform (a blog post
    // or article is a legitimate reference too) — detect one only to power
    // the embed/thumbnail below, never to reject the link the way content.
    // service.ts's create() does for the brand's own PublishedContent.
    const platform = input.platform ?? detectPlatform(input.url);
    const embed = platform ? buildEmbed(input.url, platform) : null;
    // Best-effort cover image, same pattern as content.service.ts::create() —
    // time-boxed, never blocks on a slow/broken source page.
    const thumbnailUrl =
      embed && embed.kind !== 'link-only' && platform
        ? await resolveContentThumbnail({ platform, canonicalUrl: embed.canonicalUrl, externalId: embed.externalId, timeoutMs: 3500 }).catch(
            () => null,
          )
        : null;

    const row = await prisma.inspirationItem.create({
      data: {
        url: input.url,
        platform: platform ?? null,
        thumbnailUrl,
        title: input.title ?? null,
        note: input.note ?? null,
        category: input.category,
        tags: input.tags,
        brandId: input.brandId ?? null,
        campaignId: input.campaignId ?? null,
        scriptReferenceId: input.scriptReferenceId ?? null,
        submittedById: actor.id,
      },
      include: inspirationInclude,
    });
    return toDTO(row);
  }

  async function update(id: string, input: InspirationUpdate): Promise<InspirationItemDTO> {
    requireActor(ctx);
    const existing = await prisma.inspirationItem.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Inspiration item');
    await assertInScope(existing.brandId);
    if (input.brandId !== undefined && input.brandId !== null) await assertInScope(input.brandId);
    if (input.pinned !== undefined && input.pinned !== existing.pinned) {
      // Pinning surfaces an item at the top of the whole team's feed — same
      // "admin or the person who put it there" bar as a pinned Note (PART 8),
      // not open to every reader. Centralized via requireOwnerOrAdmin
      // (Security & Authorization Freeze Gate) instead of an inline
      // actor.role/actor.id comparison.
      requireOwnerOrAdmin(ctx, existing.submittedById, 'inspiration item');
    }
    const row = await prisma.inspirationItem.update({
      where: { id },
      data: {
        title: input.title !== undefined ? input.title : undefined,
        note: input.note !== undefined ? input.note : undefined,
        category: input.category ?? undefined,
        tags: input.tags ?? undefined,
        brandId: input.brandId !== undefined ? input.brandId : undefined,
        campaignId: input.campaignId !== undefined ? input.campaignId : undefined,
        scriptReferenceId: input.scriptReferenceId !== undefined ? input.scriptReferenceId : undefined,
        status: input.status ?? undefined,
        pinned: input.pinned ?? undefined,
      },
      include: inspirationInclude,
    });
    return toDTO(row);
  }

  async function remove(id: string): Promise<void> {
    const existing = await prisma.inspirationItem.findUnique({ where: { id }, select: { brandId: true, submittedById: true } });
    if (!existing) throw AppError.notFound('Inspiration item');
    await assertInScope(existing.brandId);
    // Centralized via requireOwnerOrAdmin (Security & Authorization Freeze
    // Gate) instead of an inline actor.role/actor.id comparison.
    requireOwnerOrAdmin(ctx, existing.submittedById, 'inspiration item');
    await prisma.inspirationItem.delete({ where: { id } });
  }

  return { list, get, create, update, remove };
}

export type InspirationService = ReturnType<typeof makeInspirationService>;
