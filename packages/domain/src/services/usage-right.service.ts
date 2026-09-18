import { requests, type UsageRightDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import { computeUsageRightEffectiveStatus, daysUntilExpiry } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { iso, logActivity } from '../lib/helpers';

type UsageRightCreate = z.infer<typeof requests.usageRightCreateSchema>;
type UsageRightUpdate = z.infer<typeof requests.usageRightUpdateSchema>;

const usageRightInclude = {
  campaign: { select: { name: true } },
  influencer: { select: { displayName: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.UsageRightInclude;

type Row = Prisma.UsageRightGetPayload<{ include: typeof usageRightInclude }>;

function toDTO(r: Row): UsageRightDTO {
  return {
    id: r.id,
    brandId: r.brandId,
    campaignId: r.campaignId,
    campaignName: r.campaign?.name ?? null,
    influencerId: r.influencerId,
    influencerName: r.influencer?.displayName ?? null,
    publishedContentId: r.publishedContentId,
    usageType: r.usageType,
    scope: r.scope,
    territory: r.territory,
    exclusive: r.exclusive,
    competitorRestriction: r.competitorRestriction,
    disclosureRequired: r.disclosureRequired,
    startsAt: iso(r.startsAt),
    expiresAt: iso(r.expiresAt),
    status: r.status,
    effectiveStatus: computeUsageRightEffectiveStatus(r.status, r.expiresAt),
    daysUntilExpiry: daysUntilExpiry(r.expiresAt),
    notes: r.notes,
    createdByName: r.createdBy?.name ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Usage-rights (content-licensing) ledger (W3-2). Records what content a brand
 * may use, in what way, where, and until when. The stored `status` is
 * ACTIVE/EXPIRED/REVOKED; the DTO also carries a derived `effectiveStatus`
 * (EXPIRING_SOON inside the warning window) so the UI and reports never plan ad
 * spend on rights that have lapsed or are about to — the worker raises the
 * matching license-expiry alert on the same derivation.
 */
export function makeUsageRightService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function brandOrThrow(brandId: string) {
    const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand) throw AppError.notFound('Brand');
    return brand;
  }

  /** Guard that referenced campaign/influencer/content actually belong under the brand. */
  async function assertReferences(brandId: string, input: Pick<UsageRightCreate, 'campaignId' | 'influencerId' | 'publishedContentId'>) {
    if (input.campaignId) {
      const c = await prisma.campaign.findUnique({ where: { id: input.campaignId }, select: { brandId: true } });
      if (!c) throw AppError.notFound('Campaign');
      if (c.brandId !== brandId) throw AppError.badRequest('Campaign does not belong to this brand.');
    }
    if (input.influencerId) {
      const inf = await prisma.influencer.findUnique({ where: { id: input.influencerId }, select: { id: true } });
      if (!inf) throw AppError.notFound('Influencer');
    }
    if (input.publishedContentId) {
      const pc = await prisma.publishedContent.findUnique({ where: { id: input.publishedContentId }, select: { brandId: true } });
      if (!pc) throw AppError.notFound('Published content');
      if (pc.brandId && pc.brandId !== brandId) throw AppError.badRequest('Content does not belong to this brand.');
    }
  }

  async function listForBrand(brandId: string): Promise<UsageRightDTO[]> {
    await brandOrThrow(brandId);
    const rows = await prisma.usageRight.findMany({
      where: { brandId },
      orderBy: [{ status: 'asc' }, { expiresAt: 'asc' }, { createdAt: 'desc' }],
      include: usageRightInclude,
    });
    return rows.map(toDTO);
  }

  async function get(id: string): Promise<UsageRightDTO> {
    const row = await prisma.usageRight.findUnique({ where: { id }, include: usageRightInclude });
    if (!row) throw AppError.notFound('Usage right');
    return toDTO(row);
  }

  async function create(brandId: string, input: UsageRightCreate): Promise<UsageRightDTO> {
    const actor = requireActor(ctx);
    await brandOrThrow(brandId);
    await assertReferences(brandId, input);

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.usageRight.create({
        data: {
          brandId,
          campaignId: input.campaignId ?? null,
          influencerId: input.influencerId ?? null,
          publishedContentId: input.publishedContentId ?? null,
          usageType: input.usageType,
          scope: input.scope ?? null,
          territory: input.territory ?? null,
          exclusive: input.exclusive ?? false,
          competitorRestriction: input.competitorRestriction ?? null,
          disclosureRequired: input.disclosureRequired ?? false,
          startsAt: input.startsAt ?? null,
          expiresAt: input.expiresAt ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
        },
        include: usageRightInclude,
      });
      await logActivity(
        ctx,
        {
          type: 'BRAND_UPDATED',
          message: `${actor.name} recorded a ${created.usageType.replace(/_/g, ' ').toLowerCase()} usage right.`,
          brandId,
          campaignId: created.campaignId,
          influencerId: created.influencerId,
          publishedContentId: created.publishedContentId,
          meta: { usageRightId: created.id },
        },
        tx,
      );
      return created;
    });
    return toDTO(row);
  }

  async function update(id: string, input: UsageRightUpdate): Promise<UsageRightDTO> {
    requireActor(ctx);
    const existing = await prisma.usageRight.findUnique({ where: { id }, select: { brandId: true } });
    if (!existing) throw AppError.notFound('Usage right');
    await assertReferences(existing.brandId, {
      campaignId: input.campaignId ?? null,
      influencerId: input.influencerId ?? null,
      publishedContentId: input.publishedContentId ?? null,
    });

    const data: Prisma.UsageRightUpdateInput = {};
    if (input.usageType !== undefined) data.usageType = input.usageType;
    if (input.scope !== undefined) data.scope = input.scope ?? null;
    if (input.territory !== undefined) data.territory = input.territory ?? null;
    if (input.exclusive !== undefined) data.exclusive = input.exclusive;
    if (input.competitorRestriction !== undefined) data.competitorRestriction = input.competitorRestriction ?? null;
    if (input.disclosureRequired !== undefined) data.disclosureRequired = input.disclosureRequired;
    if (input.startsAt !== undefined) data.startsAt = input.startsAt ?? null;
    if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt ?? null;
    if (input.notes !== undefined) data.notes = input.notes ?? null;
    if (input.campaignId !== undefined) {
      data.campaign = input.campaignId ? { connect: { id: input.campaignId } } : { disconnect: true };
    }
    if (input.influencerId !== undefined) {
      data.influencer = input.influencerId ? { connect: { id: input.influencerId } } : { disconnect: true };
    }
    if (input.publishedContentId !== undefined) {
      data.publishedContent = input.publishedContentId ? { connect: { id: input.publishedContentId } } : { disconnect: true };
    }

    const row = await prisma.usageRight.update({ where: { id }, data, include: usageRightInclude });
    return toDTO(row);
  }

  /** Manually revoke a license (rights withdrawn before natural expiry). */
  async function revoke(id: string): Promise<UsageRightDTO> {
    const actor = requireActor(ctx);
    const existing = await prisma.usageRight.findUnique({ where: { id }, select: { id: true, brandId: true, status: true } });
    if (!existing) throw AppError.notFound('Usage right');
    if (existing.status === 'REVOKED') throw AppError.badRequest('This usage right is already revoked.');

    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.usageRight.update({
        where: { id },
        data: { status: 'REVOKED' },
        include: usageRightInclude,
      });
      await logActivity(
        ctx,
        {
          type: 'BRAND_UPDATED',
          message: `${actor.name} revoked a usage right.`,
          brandId: existing.brandId,
          meta: { usageRightId: id },
        },
        tx,
      );
      return updated;
    });
    return toDTO(row);
  }

  return { listForBrand, get, create, update, revoke };
}

export type UsageRightService = ReturnType<typeof makeUsageRightService>;
