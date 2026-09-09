import { slugify } from '@influenceos/shared';
import { requests, type BrandDetailDTO, type BrandSummaryDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireAdmin } from '../lib/authz';
import { logActivity, uniqueSlug } from '../lib/helpers';
import { moneyNumberOr0, sumMoney } from '../lib/money';
import { toBrandSummary } from '../lib/mappers';

const summarySelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  iconUrl: true,
  primaryColor: true,
  accentColor: true,
  isActive: true,
} as const;

type BrandCreate = z.infer<typeof requests.brandCreateSchema>;
type BrandUpdate = z.infer<typeof requests.brandUpdateSchema>;

export function makeBrandService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function list(opts: { includeInactive?: boolean } = {}): Promise<BrandSummaryDTO[]> {
    const brands = await prisma.brand.findMany({
      where: opts.includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
      select: summarySelect,
    });
    return brands.map(toBrandSummary);
  }

  async function findByIdOrSlug(idOrSlug: string) {
    const brand = await prisma.brand.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    });
    if (!brand) throw AppError.notFound('Brand');
    return brand;
  }

  async function detail(idOrSlug: string): Promise<BrandDetailDTO> {
    const brand = await findByIdOrSlug(idOrSlug);
    const [activeCampaigns, totalCampaigns, influencers, contentCount, fees, expenses] =
      await Promise.all([
        prisma.campaign.count({ where: { brandId: brand.id, status: 'ACTIVE' } }),
        prisma.campaign.count({ where: { brandId: brand.id } }),
        prisma.brandInfluencer.count({ where: { brandId: brand.id } }),
        prisma.publishedContent.count({ where: { brandId: brand.id } }),
        prisma.campaignInfluencer.aggregate({
          _sum: { agreedCost: true },
          where: { campaign: { brandId: brand.id }, dealType: { in: ['PAID', 'PAID_PLUS_GIFTED'] } },
        }),
        prisma.campaignExpense.aggregate({
          _sum: { amount: true },
          where: { campaign: { brandId: brand.id }, type: { not: 'GIFT_PRODUCT' } },
        }),
      ]);

    const totalSpend = moneyNumberOr0(sumMoney([fees._sum.agreedCost, expenses._sum.amount]));

    return {
      ...toBrandSummary(brand),
      description: brand.description,
      coverUrl: brand.coverUrl,
      secondaryColor: brand.secondaryColor,
      createdAt: brand.createdAt.toISOString(),
      stats: {
        activeCampaigns,
        totalCampaigns,
        influencers,
        contentCount,
        totalSpend,
        currency: 'KWD',
      },
    };
  }

  async function create(input: BrandCreate): Promise<BrandDetailDTO> {
    requireAdmin(ctx);
    const slug = await uniqueSlug(
      input.slug || slugify(input.name),
      async (c) => !!(await prisma.brand.findUnique({ where: { slug: c } })),
    );
    const brand = await prisma.brand.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        logoUrl: input.logoUrl ?? null,
        iconUrl: input.iconUrl ?? null,
        coverUrl: input.coverUrl ?? null,
        primaryColor: input.primaryColor,
        accentColor: input.accentColor ?? null,
        secondaryColor: input.secondaryColor ?? null,
        isActive: input.isActive ?? true,
      },
    });
    await logActivity(ctx, {
      type: 'BRAND_CREATED',
      message: `${ctx.actor?.name ?? 'Someone'} created the brand ${brand.name}.`,
      brandId: brand.id,
    });
    return detail(brand.id);
  }

  async function update(id: string, input: BrandUpdate): Promise<BrandDetailDTO> {
    requireAdmin(ctx);
    const existing = await findByIdOrSlug(id);
    let slug = existing.slug;
    if (input.slug && input.slug !== existing.slug) {
      slug = await uniqueSlug(
        input.slug,
        async (c) => c !== existing.slug && !!(await prisma.brand.findUnique({ where: { slug: c } })),
      );
    }
    await prisma.brand.update({
      where: { id: existing.id },
      data: {
        name: input.name ?? undefined,
        slug,
        description: input.description === undefined ? undefined : input.description,
        logoUrl: input.logoUrl === undefined ? undefined : input.logoUrl,
        iconUrl: input.iconUrl === undefined ? undefined : input.iconUrl,
        coverUrl: input.coverUrl === undefined ? undefined : input.coverUrl,
        primaryColor: input.primaryColor ?? undefined,
        accentColor: input.accentColor === undefined ? undefined : input.accentColor,
        secondaryColor: input.secondaryColor === undefined ? undefined : input.secondaryColor,
        isActive: input.isActive ?? undefined,
      },
    });
    await logActivity(ctx, {
      type: 'BRAND_UPDATED',
      message: `${ctx.actor?.name ?? 'Someone'} updated the brand ${existing.name}.`,
      brandId: existing.id,
    });
    return detail(existing.id);
  }

  return { list, detail, create, update, findByIdOrSlug };
}

export type BrandService = ReturnType<typeof makeBrandService>;
