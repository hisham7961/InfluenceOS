import { requests, type BrandInfluencerDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { iso, logActivity } from '../lib/helpers';
import { toMoneyNumber, type MoneyInput } from '../lib/money';
import { toBrandSummary } from '../lib/mappers';

type BrandInfluencerInput = z.infer<typeof requests.brandInfluencerSchema>;

const brandSelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  iconUrl: true,
  primaryColor: true,
  accentColor: true,
  isActive: true,
} as const;

interface BrandInfluencerRow {
  id: string;
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
  relationshipStatus: BrandInfluencerDTO['relationshipStatus'];
  priority: BrandInfluencerDTO['priority'];
  defaultRate: MoneyInput;
  currency: string | null;
  totalCollaborations: number;
  lastCampaignAt: Date | null;
  internalNotes: string | null;
  isActive: boolean;
}

function toBrandInfluencerDTO(bi: BrandInfluencerRow): BrandInfluencerDTO {
  return {
    id: bi.id,
    brand: toBrandSummary(bi.brand),
    relationshipStatus: bi.relationshipStatus,
    priority: bi.priority,
    defaultRate: toMoneyNumber(bi.defaultRate),
    currency: bi.currency,
    totalCollaborations: bi.totalCollaborations,
    lastCampaignAt: iso(bi.lastCampaignAt),
    internalNotes: bi.internalNotes,
    isActive: bi.isActive,
  };
}

/**
 * Brand <-> Influencer relationship layer (spec §5). A single global
 * Influencer record can carry a distinct relationship (status, priority,
 * rate, notes) with each Brand it works with, without duplicating the
 * influencer's own profile.
 */
export function makeBrandInfluencerService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function upsert(input: BrandInfluencerInput): Promise<BrandInfluencerDTO> {
    requireActor(ctx);

    const [brand, influencer] = await Promise.all([
      prisma.brand.findUnique({ where: { id: input.brandId } }),
      prisma.influencer.findUnique({ where: { id: input.influencerId } }),
    ]);
    if (!brand) throw AppError.notFound('Brand');
    if (!influencer) throw AppError.notFound('Influencer');

    const existing = await prisma.brandInfluencer.findUnique({
      where: { brandId_influencerId: { brandId: input.brandId, influencerId: input.influencerId } },
      select: { id: true },
    });

    const bi = await prisma.brandInfluencer.upsert({
      where: { brandId_influencerId: { brandId: input.brandId, influencerId: input.influencerId } },
      create: {
        brandId: input.brandId,
        influencerId: input.influencerId,
        relationshipStatus: input.relationshipStatus,
        priority: input.priority,
        internalNotes: input.internalNotes ?? null,
        defaultRate: input.defaultRate ?? null,
        currency: input.currency ?? null,
        isActive: input.isActive,
      },
      update: {
        relationshipStatus: input.relationshipStatus,
        priority: input.priority,
        internalNotes: input.internalNotes === undefined ? undefined : input.internalNotes,
        defaultRate: input.defaultRate === undefined ? undefined : input.defaultRate,
        currency: input.currency === undefined ? undefined : input.currency,
        isActive: input.isActive,
      },
      include: { brand: { select: brandSelect } },
    });

    await logActivity(ctx, {
      type: 'GENERIC',
      message: existing
        ? `${ctx.actor?.name ?? 'Someone'} updated ${brand.name}'s relationship with ${influencer.displayName}.`
        : `${ctx.actor?.name ?? 'Someone'} linked ${influencer.displayName} to ${brand.name}.`,
      brandId: brand.id,
      influencerId: influencer.id,
    });

    return toBrandInfluencerDTO(bi);
  }

  async function listForInfluencer(influencerId: string): Promise<BrandInfluencerDTO[]> {
    const rows = await prisma.brandInfluencer.findMany({
      where: { influencerId },
      include: { brand: { select: brandSelect } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(toBrandInfluencerDTO);
  }

  async function get(brandId: string, influencerId: string): Promise<BrandInfluencerDTO | null> {
    const bi = await prisma.brandInfluencer.findUnique({
      where: { brandId_influencerId: { brandId, influencerId } },
      include: { brand: { select: brandSelect } },
    });
    return bi ? toBrandInfluencerDTO(bi) : null;
  }

  async function remove(id: string): Promise<void> {
    requireActor(ctx);
    const existing = await prisma.brandInfluencer.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Brand-influencer relationship');
    await prisma.brandInfluencer.delete({ where: { id } });
    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${ctx.actor?.name ?? 'Someone'} removed a brand-influencer relationship.`,
      brandId: existing.brandId,
      influencerId: existing.influencerId,
    });
  }

  return { upsert, listForInfluencer, get, remove };
}

export type BrandInfluencerService = ReturnType<typeof makeBrandInfluencerService>;
