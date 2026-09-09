import { slugify, type Platform } from '@influenceos/shared';
import {
  buildOffsetPagination,
  requests,
  type CampaignDetailDTO,
  type CampaignProgressDTO,
  type CampaignSummaryDTO,
  type Paginated,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { dec, iso, logActivity, uniqueSlug } from '../lib/helpers';
import { toBrandSummary } from '../lib/mappers';
import { computeCampaignProgress } from '../lib/progress';

type CampaignCreate = z.infer<typeof requests.campaignCreateSchema>;
type CampaignUpdate = z.infer<typeof requests.campaignUpdateSchema>;
type CampaignFilter = z.infer<typeof requests.campaignFilterSchema>;

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
  plannedBudget: unknown;
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
      plannedBudget: dec(c.plannedBudget as never),
      progress,
    };
  }

  async function list(filter: CampaignFilter): Promise<Paginated<CampaignSummaryDTO>> {
    const where: Prisma.CampaignWhereInput = {};
    if (filter.brandId) where.brandId = filter.brandId;
    if (filter.status) where.status = filter.status;
    if (filter.objective) where.objective = filter.objective;
    if (filter.ownerId) where.ownerId = filter.ownerId;
    if (filter.q) where.name = { contains: filter.q, mode: 'insensitive' };

    const [total, rows] = await Promise.all([
      prisma.campaign.count({ where }),
      prisma.campaign.findMany({
        where,
        include: { brand: { select: brandSummarySelect } },
        orderBy: [{ status: 'asc' }, { startDate: 'desc' }, { createdAt: 'desc' }],
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
    ]);

    const data = await Promise.all(
      rows.map(async (c) => toSummary(c as CampaignRow, await computeCampaignProgress(ctx, c))),
    );
    return { data, pagination: buildOffsetPagination(filter.page, filter.pageSize, total) };
  }

  async function findByIdOrSlug(idOrSlug: string, brandId?: string) {
    const campaign = await prisma.campaign.findFirst({
      where: brandId
        ? { brandId, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
        : { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { brand: { select: brandSummarySelect }, owner: { select: { id: true, name: true } } },
    });
    if (!campaign) throw AppError.notFound('Campaign');
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
      createdAt: c.createdAt.toISOString(),
    };
  }

  async function create(input: CampaignCreate): Promise<CampaignDetailDTO> {
    requireActor(ctx);
    const brand = await prisma.brand.findUnique({ where: { id: input.brandId } });
    if (!brand) throw AppError.notFound('Brand');
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
    requireActor(ctx);
    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Campaign');

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

  return { list, detail, create, update, findByIdOrSlug, brandSummarySelect };
}

export type CampaignService = ReturnType<typeof makeCampaignService>;
