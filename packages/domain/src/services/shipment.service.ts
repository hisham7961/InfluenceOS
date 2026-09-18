import { requests, type ProductShipmentDTO, type ShipmentStatus } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { iso, logActivity } from '../lib/helpers';

type ShipmentUpsert = z.infer<typeof requests.shipmentUpsertSchema>;
type ShipmentStatusInput = z.infer<typeof requests.shipmentStatusSchema>;

type Row = Prisma.ProductShipmentGetPayload<Record<string, never>>;

function toDTO(s: Row): ProductShipmentDTO {
  return {
    id: s.id,
    campaignInfluencerId: s.campaignInfluencerId,
    recipientName: s.recipientName,
    phone: s.phone,
    addressLine1: s.addressLine1,
    addressLine2: s.addressLine2,
    city: s.city,
    country: s.country,
    postalCode: s.postalCode,
    courier: s.courier,
    trackingNumber: s.trackingNumber,
    trackingUrl: s.trackingUrl,
    status: s.status,
    shippedAt: iso(s.shippedAt),
    deliveredAt: iso(s.deliveredAt),
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// Reaching a shipped-ish/delivered state stamps the matching timestamp the
// first time it happens, unless the caller supplied one explicitly.
function autoTimestamps(status: ShipmentStatus | undefined, current: { shippedAt: Date | null; deliveredAt: Date | null }, supplied: { shippedAt?: Date | null; deliveredAt?: Date | null }, now: Date) {
  const out: { shippedAt?: Date; deliveredAt?: Date } = {};
  const shippedish = status === 'SHIPPED' || status === 'IN_TRANSIT' || status === 'DELIVERED';
  if (shippedish && current.shippedAt == null && supplied.shippedAt == null) out.shippedAt = now;
  if (status === 'DELIVERED' && current.deliveredAt == null && supplied.deliveredAt == null) out.deliveredAt = now;
  return out;
}

/**
 * Product-seeding shipment tracking (W3-5). One shipment per gift record —
 * address, courier, tracking and delivery state — so staff can answer "did the
 * product arrive?" from inside the campaign. Reaching SHIPPED/DELIVERED stamps
 * the corresponding timestamp automatically.
 */
export function makeShipmentService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function ciContext(campaignInfluencerId: string) {
    const ci = await prisma.campaignInfluencer.findUnique({
      where: { id: campaignInfluencerId },
      select: { id: true, campaignId: true, influencerId: true, campaign: { select: { brandId: true } } },
    });
    if (!ci) throw AppError.notFound('Campaign influencer');
    return ci;
  }

  async function get(campaignInfluencerId: string): Promise<ProductShipmentDTO | null> {
    await ciContext(campaignInfluencerId);
    const row = await prisma.productShipment.findUnique({ where: { campaignInfluencerId } });
    return row ? toDTO(row) : null;
  }

  async function upsert(campaignInfluencerId: string, input: ShipmentUpsert): Promise<ProductShipmentDTO> {
    const actor = requireActor(ctx);
    const ci = await ciContext(campaignInfluencerId);
    const now = new Date();
    const existing = await prisma.productShipment.findUnique({ where: { campaignInfluencerId } });

    const stamps = autoTimestamps(
      input.status,
      { shippedAt: existing?.shippedAt ?? null, deliveredAt: existing?.deliveredAt ?? null },
      { shippedAt: input.shippedAt, deliveredAt: input.deliveredAt },
      now,
    );

    const fields = {
      recipientName: input.recipientName ?? null,
      phone: input.phone ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      postalCode: input.postalCode ?? null,
      courier: input.courier ?? null,
      trackingNumber: input.trackingNumber ?? null,
      trackingUrl: input.trackingUrl ?? null,
      notes: input.notes ?? null,
      shippedAt: input.shippedAt ?? stamps.shippedAt ?? null,
      deliveredAt: input.deliveredAt ?? stamps.deliveredAt ?? null,
    };

    const row = await prisma.productShipment.upsert({
      where: { campaignInfluencerId },
      create: {
        campaignInfluencerId,
        status: input.status ?? 'PENDING',
        createdById: actor.id,
        ...fields,
      },
      update: {
        ...(input.status ? { status: input.status } : {}),
        ...fields,
      },
    });
    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} ${existing ? 'updated' : 'created'} a product shipment (${row.status.replace(/_/g, ' ').toLowerCase()}).`,
      brandId: ci.campaign.brandId,
      campaignId: ci.campaignId,
      influencerId: ci.influencerId,
      meta: { shipmentId: row.id, status: row.status },
    });
    return toDTO(row);
  }

  async function updateStatus(campaignInfluencerId: string, input: ShipmentStatusInput): Promise<ProductShipmentDTO> {
    const actor = requireActor(ctx);
    const ci = await ciContext(campaignInfluencerId);
    const existing = await prisma.productShipment.findUnique({ where: { campaignInfluencerId } });
    if (!existing) throw AppError.notFound('Shipment');
    const now = new Date();
    const stamps = autoTimestamps(input.status, { shippedAt: existing.shippedAt, deliveredAt: existing.deliveredAt }, {}, now);

    const row = await prisma.productShipment.update({
      where: { campaignInfluencerId },
      data: { status: input.status, ...stamps },
    });
    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} marked a shipment ${input.status.replace(/_/g, ' ').toLowerCase()}.`,
      brandId: ci.campaign.brandId,
      campaignId: ci.campaignId,
      influencerId: ci.influencerId,
      meta: { shipmentId: existing.id, from: existing.status, to: input.status },
    });
    return toDTO(row);
  }

  return { get, upsert, updateStatus };
}

export type ShipmentService = ReturnType<typeof makeShipmentService>;
