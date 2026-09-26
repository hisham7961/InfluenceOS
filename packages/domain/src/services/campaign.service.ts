import { slugify, type Platform } from '@influenceos/shared';
import {
  buildOffsetPagination,
  requests,
  type CampaignDetailDTO,
  type CampaignProgressDTO,
  type CampaignSummaryDTO,
  type CursorPage,
  type Paginated,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireCapability } from '../lib/authz';
import { buildCursorPage } from '../lib/cursor';
import { iso, logActivity, uniqueSlug } from '../lib/helpers';
import { toMoneyNumber, type MoneyInput } from '../lib/money';
import { toBrandSummary } from '../lib/mappers';
import { computeCampaignProgress, computeCampaignProgressBatch } from '../lib/progress';
import { isBrandOutOfScope, scopedBrandIds } from '../lib/scope';

type CampaignCreate = z.infer<typeof requests.campaignCreateSchema>;
type CampaignUpdate = z.infer<typeof requests.campaignUpdateSchema>;
type CampaignFilter = z.infer<typeof requests.campaignFilterSchema>;
type CampaignCursorQuery = z.infer<typeof requests.campaignCursorSchema>;

const brandSummarySelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  iconUrl: true,
  primaryColor: true,
  accentColor: true,
  isActive: true,
} as const;

interface CampaignRow {
  id: string;
  brandId: string;
  name: string;
  slug: string;
  coverUrl: string | null;
  status: CampaignSummaryDTO['status'];
  objective: CampaignSummaryDTO['objective'];
  startDate: Date | null;
  endDate: Date | null;
  currency: string;
  plannedBudget: MoneyInput;
  brand: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    iconUrl: string | null;
    primaryColor: string;
    accentColor: string | null;
    isActive: boolean;
  };
}

export function makeCampaignService(ctx: DomainContext) {
  const { prisma } = ctx;

  function toSummary(c: CampaignRow, progress: CampaignProgressDTO): CampaignSummaryDTO {
    return {
      id: c.id,
      brandId: c.brandId,
      brand: toBrandSummary(c.brand),
      name: c.name,
      slug: c.slug,
      coverUrl: c.coverUrl,
      status: c.status,
      objective: c.objective,
      startDate: iso(c.startDate),
      endDate: iso(c.endDate),
      currency: c.currency,
      plannedBudget: toMoneyNumber(c.plannedBudget),
      progress,
    };
  }

  // Security & Authorization Freeze Gate — Campaign Brand Scope (HARD BLOCKER):
  // this was the single most significant gap the previous audit found —
  // campaign.service.ts never composed the actor's own brand scope into any
  // query, only an explicit, client-supplied filter.brandId. Mirrors the
  // exact posture every other brand-touching service uses (influencer.
  // service.ts, shipment.service.ts, content.service.ts): an out-of-scope
  // explicit brandId matches nothing rather than silently widening; an
  // unscoped actor (ADMIN, or no explicit UserBrandAccess rows) is untouched.
  async function buildWhere(filter: CampaignFilter | CampaignCursorQuery): Promise<Prisma.CampaignWhereInput> {
    const where: Prisma.CampaignWhereInput = {};
    const brandScope = await scopedBrandIds(ctx);
    if (filter.brandId) {
      where.brandId = brandScope && !brandScope.includes(filter.brandId) ? { in: [] } : filter.brandId;
    } else if (brandScope) {
      where.brandId = { in: brandScope };
    }
    if (filter.status) where.status = filter.status;
    if (filter.objective) where.objective = filter.objective;
    if (filter.ownerId) where.ownerId = filter.ownerId;
    // Mirrors dashboard.service.ts's 'campaigns-missing-owner' Needs Attention
    // item exactly, so its count and this deep link never disagree. Only
    // applies the item's own ACTIVE/PLANNING constraint when the caller
    // didn't already set an explicit status filter — an explicit filter.status
    // (checked above) always wins rather than being silently clobbered.
    if (filter.ownerMissing) {
      where.ownerId = null;
      if (!filter.status) where.status = { in: ['ACTIVE', 'PLANNING'] };
    }
    if (filter.q) where.name = { contains: filter.q, mode: 'insensitive' };
    return where;
  }

  /** Newest first by default; `sort` may pick start date, end date or name. */
  function campaignOrder(filter: CampaignFilter): Prisma.CampaignOrderByWithRelationInput[] {
    const dir = filter.order ?? 'desc';
    const by =
      filter.sort === 'startDate' || filter.sort === 'endDate'
        ? { [filter.sort]: { sort: dir, nulls: 'last' } }
        : filter.sort === 'name'
          ? { name: dir }
          : { createdAt: dir };
    return [by as Prisma.CampaignOrderByWithRelationInput, { id: dir }];
  }

  async function list(filter: CampaignFilter): Promise<Paginated<CampaignSummaryDTO>> {
    const where = await buildWhere(filter);
    const [total, rows] = await Promise.all([
      prisma.campaign.count({ where }),
      prisma.campaign.findMany({
        where,
        include: { brand: { select: brandSummarySelect } },
        orderBy: campaignOrder(filter),
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
    ]);

    // One batched progress computation for the whole page (fixed 3 queries),
    // not one fan-out per campaign (PERF-01 / W7-1). The batch keys every input
    // campaign, so the lookup always resolves.
    const progress = await computeCampaignProgressBatch(ctx, rows);
    const data = rows.map((c) => toSummary(c as CampaignRow, progress.get(c.id)!));
    return { data, pagination: buildOffsetPagination(filter.page, filter.pageSize, total) };
  }

  // Keyset (cursor) directory paging (W7-2). Orders by (createdAt desc, id desc)
  // — id is the stable tiebreaker — backed by the Campaign_createdAt_id index.
  // Progress is still batched (W7-1), so a page costs a fixed number of queries.
  async function listCursor(filter: CampaignCursorQuery): Promise<CursorPage<CampaignSummaryDTO>> {
    const where = await buildWhere(filter);
    const rows = await prisma.campaign.findMany({
      where,
      include: { brand: { select: brandSummarySelect } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const progress = await computeCampaignProgressBatch(ctx, rows);
    const summaries = rows.map((c) => toSummary(c as CampaignRow, progress.get(c.id)!));
    return buildCursorPage(summaries, filter.limit);
  }

  async function findByIdOrSlug(idOrSlug: string, brandId?: string) {
    const campaign = await prisma.campaign.findFirst({
      where: brandId
        ? { brandId, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
        : { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { brand: { select: brandSummarySelect }, owner: { select: { id: true, name: true } } },
    });
    if (!campaign) throw AppError.notFound('Campaign');
    // Direct-ID brand scope (Security & Authorization Freeze Gate) — a
    // scoped actor can never reach an out-of-scope campaign by guessing its
    // id/slug, not merely have it hidden from a filtered list. The optional
    // `brandId` param above is an explicit route-supplied narrowing (e.g. the
    // nested /brands/:brandId/campaigns/:id route), unrelated to the actor's
    // own scope — both must independently pass.
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, campaign.brandId)) throw AppError.notFound('Campaign');
    return campaign;
  }

  /**
   * Lean, direct-ID brand-scope-checked campaign lookup for OTHER services to
   * reuse (Security & Authorization Freeze Gate, section 10 — child
   * resources must not bypass campaign scope). Every service that resolves a
   * campaignId to fan out into a child mutation (roster, expenses, shipments,
   * submissions, sourcing, usage rights, logistics issues, notes, etc.)
   * should call this instead of its own raw `prisma.campaign.findUnique` —
   * one scope check, not one per call site to independently remember.
   */
  async function assertInScope(campaignId: string): Promise<{ id: string; brandId: string; name: string }> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, brandId: true, name: true },
    });
    if (!campaign) throw AppError.notFound('Campaign');
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, campaign.brandId)) throw AppError.notFound('Campaign');
    return campaign;
  }

  async function detail(idOrSlug: string, brandId?: string): Promise<CampaignDetailDTO> {
    const c = await findByIdOrSlug(idOrSlug, brandId);
    const [progress, publishedContentCount] = await Promise.all([
      computeCampaignProgress(ctx, c),
      prisma.publishedContent.count({ where: { campaignId: c.id } }),
    ]);
    return {
      ...toSummary(c as CampaignRow, progress),
      description: c.description,
      brief: c.brief,
      targetMarket: c.targetMarket,
      internalNotes: c.internalNotes,
      owner: c.owner ? { id: c.owner.id, name: c.owner.name } : null,
      publishedContentCount,
      draftReview: c.draftReview,
      createdAt: c.createdAt.toISOString(),
    };
  }

  async function create(input: CampaignCreate): Promise<CampaignDetailDTO> {
    await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const brand = await prisma.brand.findUnique({ where: { id: input.brandId } });
    if (!brand) throw AppError.notFound('Brand');
    // Capability grants WHAT the actor can do; scope grants WHERE — both are
    // required. CAMPAIGNS_MANAGE alone must never let a brand-scoped actor
    // create a campaign under a brand they don't have access to.
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, input.brandId)) throw AppError.notFound('Brand');
    const slug = await uniqueSlug(
      input.slug || slugify(input.name),
      async (c) =>
        !!(await prisma.campaign.findUnique({
          where: { brandId_slug: { brandId: input.brandId, slug: c } },
        })),
    );
    const campaign = await prisma.campaign.create({
      data: {
        brandId: input.brandId,
        name: input.name,
        slug,
        coverUrl: input.coverUrl ?? null,
        description: input.description ?? null,
        brief: input.brief ?? null,
        objective: input.objective ?? null,
        status: input.status ?? 'DRAFT',
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        currency: input.currency ?? 'KWD',
        plannedBudget: input.plannedBudget ?? null,
        targetMarket: input.targetMarket ?? null,
        ownerId: input.ownerId ?? ctx.actor?.id ?? null,
        internalNotes: input.internalNotes ?? null,
        draftReview: input.draftReview ?? false,
      },
    });
    await logActivity(ctx, {
      type: 'CAMPAIGN_CREATED',
      message: `${ctx.actor?.name ?? 'Someone'} created the campaign ${campaign.name} for ${brand.name}.`,
      brandId: brand.id,
      campaignId: campaign.id,
    });
    return detail(campaign.id);
  }

  async function update(id: string, input: CampaignUpdate): Promise<CampaignDetailDTO> {
    await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Campaign');
    // Direct-ID brand scope — CAMPAIGNS_MANAGE alone must never let a
    // brand-scoped actor mutate a campaign outside their brand access, even
    // when they know/guess its id (not merely have it hidden from a list).
    // brandId itself is not attacker-controlled here: campaignUpdateSchema
    // omits it, so this is the only brand check update() needs.
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, existing.brandId)) throw AppError.notFound('Campaign');

    let slug = existing.slug;
    if (input.slug && input.slug !== existing.slug) {
      slug = await uniqueSlug(
        input.slug,
        async (c) =>
          c !== existing.slug &&
          !!(await prisma.campaign.findUnique({
            where: { brandId_slug: { brandId: existing.brandId, slug: c } },
          })),
      );
    }

    await prisma.campaign.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        slug,
        coverUrl: input.coverUrl === undefined ? undefined : input.coverUrl,
        description: input.description === undefined ? undefined : input.description,
        brief: input.brief === undefined ? undefined : input.brief,
        objective: input.objective === undefined ? undefined : input.objective,
        status: input.status ?? undefined,
        startDate: input.startDate === undefined ? undefined : input.startDate,
        endDate: input.endDate === undefined ? undefined : input.endDate,
        currency: input.currency ?? undefined,
        plannedBudget: input.plannedBudget === undefined ? undefined : input.plannedBudget,
        targetMarket: input.targetMarket === undefined ? undefined : input.targetMarket,
        ownerId: input.ownerId === undefined ? undefined : input.ownerId,
        internalNotes: input.internalNotes === undefined ? undefined : input.internalNotes,
        draftReview: input.draftReview ?? undefined,
      },
    });

    if (input.status && input.status !== existing.status) {
      await logActivity(ctx, {
        type: 'CAMPAIGN_STATUS_CHANGED',
        message: `${ctx.actor?.name ?? 'Someone'} moved ${existing.name} to ${input.status.toLowerCase()}.`,
        brandId: existing.brandId,
        campaignId: existing.id,
        meta: { from: existing.status, to: input.status },
      });
    } else {
      await logActivity(ctx, {
        type: 'CAMPAIGN_UPDATED',
        message: `${ctx.actor?.name ?? 'Someone'} updated ${existing.name}.`,
        brandId: existing.brandId,
        campaignId: existing.id,
      });
    }
    return detail(id);
  }

  return { list, listCursor, detail, create, update, findByIdOrSlug, assertInScope, brandSummarySelect };
}

export type CampaignService = ReturnType<typeof makeCampaignService>;
