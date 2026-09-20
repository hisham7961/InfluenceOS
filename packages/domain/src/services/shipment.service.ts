import {
  requests,
  type LogisticsRequestDTO,
  type ProductShipmentDTO,
  type ShipmentItemDTO,
  type ShipmentStatus,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { createNotification, iso, logActivity } from '../lib/helpers';
import { isBrandOutOfScope, scopedBrandIds } from '../lib/scope';

type ShipmentCreate = z.infer<typeof requests.shipmentCreateSchema>;
type ShipmentUpdate = z.infer<typeof requests.shipmentUpdateSchema>;
type ShipmentStatusInput = z.infer<typeof requests.shipmentStatusSchema>;
type ShipmentFilter = z.infer<typeof requests.shipmentFilterSchema>;

const itemsInclude = {
  items: { include: { product: { select: { name: true } } } },
} satisfies Prisma.ProductShipmentInclude;

type Row = Prisma.ProductShipmentGetPayload<{ include: typeof itemsInclude }>;

function toDTO(s: Row): ProductShipmentDTO {
  return {
    id: s.id,
    campaignInfluencerId: s.campaignInfluencerId,
    deliverableId: s.deliverableId,
    recipientName: s.recipientName,
    phone: s.phone,
    addressLine1: s.addressLine1,
    addressLine2: s.addressLine2,
    city: s.city,
    country: s.country,
    postalCode: s.postalCode,
    deliveryInstructions: s.deliveryInstructions,
    courier: s.courier,
    trackingNumber: s.trackingNumber,
    trackingUrl: s.trackingUrl,
    status: s.status,
    shippedAt: iso(s.shippedAt),
    deliveredAt: iso(s.deliveredAt),
    notes: s.notes,
    items: s.items.map(
      (i): ShipmentItemDTO => ({
        id: i.id,
        productName: i.product.name,
        sku: i.sku,
        variant: i.variant,
        quantity: i.quantity,
      }),
    ),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// Reaching a shipped-ish/delivered state stamps the matching timestamp the
// first time it happens, unless the caller supplied one explicitly.
function autoTimestamps(
  status: ShipmentStatus | undefined,
  current: { shippedAt: Date | null; deliveredAt: Date | null },
  supplied: { shippedAt?: Date | null; deliveredAt?: Date | null },
  now: Date,
) {
  const out: { shippedAt?: Date; deliveredAt?: Date } = {};
  const shippedish = status === 'SHIPPED' || status === 'IN_TRANSIT' || status === 'DELIVERED';
  if (shippedish && current.shippedAt == null && supplied.shippedAt == null) out.shippedAt = now;
  if (status === 'DELIVERED' && current.deliveredAt == null && supplied.deliveredAt == null) out.deliveredAt = now;
  return out;
}

/**
 * Logistics fulfilment requests — evolved from W3-5's "one shipment per
 * gift record" into a real multi-shipment workflow (a CampaignInfluencer may
 * need several: one per deliverable that requires a product, a replacement
 * shipment, a general campaign gift). Reuses the original ProductShipment
 * model/table rather than introducing a parallel "LogisticsRequest" entity —
 * see docs/workflow/WORKFLOW_GAP_MATRIX.md for the reuse decision. Status
 * transitions to SHIPPED/DELIVERED stamp timestamps automatically, log
 * activity (feeds the Influencer operational timeline) and notify — so a
 * campaign employee sees the same status the logistics employee just set,
 * without anyone copying it by hand.
 */
export function makeShipmentService(ctx: DomainContext) {
  const { prisma } = ctx;
  // A read-only VIEWER can see that a shipment exists and its status, but not
  // the creator's full residential address/phone — "Full residential address
  // should not be unnecessarily available to unauthorized users"
  // (WORKFLOW_GAP_MATRIX.md, Permissions/privacy). City/country stay visible
  // (general location, not PII-sensitive); ADMIN/STAFF need the rest to
  // actually fulfil shipments, so only VIEWER is redacted.
  const isViewer = ctx.actor?.role === 'VIEWER';
  function redact<T extends ProductShipmentDTO>(dto: T): T {
    if (!isViewer) return dto;
    return {
      ...dto,
      phone: null,
      addressLine1: null,
      addressLine2: null,
      postalCode: null,
      deliveryInstructions: null,
    };
  }

  async function ciContext(campaignInfluencerId: string) {
    const ci = await prisma.campaignInfluencer.findUnique({
      where: { id: campaignInfluencerId },
      select: { id: true, campaignId: true, influencerId: true, campaign: { select: { brandId: true } } },
    });
    if (!ci) throw AppError.notFound('Campaign influencer');
    // A scoped operator cannot reach shipments outside their brand access —
    // same not-found posture as brand.service.ts (WORKFLOW_GAP_MATRIX.md,
    // "Permissions/privacy"). Every shipment operation funnels through this
    // helper (list, create) so the check protects all of them.
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, ci.campaign.brandId)) throw AppError.notFound('Campaign influencer');
    return ci;
  }

  async function loadDTO(id: string): Promise<ProductShipmentDTO> {
    const row = await prisma.productShipment.findUnique({
      where: { id },
      include: { ...itemsInclude, campaignInfluencer: { select: { campaign: { select: { brandId: true } } } } },
    });
    if (!row) throw AppError.notFound('Shipment');
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, row.campaignInfluencer.campaign.brandId)) throw AppError.notFound('Shipment');
    return redact(toDTO(row));
  }

  /** All shipments for one CampaignInfluencer (no longer 0-or-1 — see module doc). */
  async function listForCampaignInfluencer(campaignInfluencerId: string): Promise<ProductShipmentDTO[]> {
    await ciContext(campaignInfluencerId);
    const rows = await prisma.productShipment.findMany({
      where: { campaignInfluencerId },
      include: itemsInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => redact(toDTO(r)));
  }

  /** Shipments fulfilling one specific deliverable. */
  async function listForDeliverable(deliverableId: string): Promise<ProductShipmentDTO[]> {
    const rows = await prisma.productShipment.findMany({
      where: { deliverableId },
      include: itemsInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => redact(toDTO(r)));
  }

  /** Every shipment for a campaign's roster in one query (W3-5 web surface). */
  async function listForCampaign(campaignId: string): Promise<ProductShipmentDTO[]> {
    const rows = await prisma.productShipment.findMany({
      where: { campaignInfluencer: { campaignId } },
      include: itemsInclude,
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => redact(toDTO(r)));
  }

  /**
   * The cross-campaign `/logistics` workspace — reads the SAME shipment rows
   * (never a copy), with just enough context (creator/brand/campaign/
   * deliverable) to be usable without a second lookup per row.
   */
  async function listAll(filter: ShipmentFilter): Promise<{ data: LogisticsRequestDTO[]; hasMore: boolean; nextCursor: string | null }> {
    // A scoped operator's cross-campaign workspace only ever shows their
    // brands — an explicit brandId filter outside that scope matches nothing
    // rather than silently widening or leaking other brands' shipments.
    const scope = await scopedBrandIds(ctx);
    const brandIdFilter: string | { in: string[] } | undefined = filter.brandId
      ? scope && !scope.includes(filter.brandId)
        ? { in: [] }
        : filter.brandId
      : scope
        ? { in: scope }
        : undefined;

    const where: Prisma.ProductShipmentWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.campaignId || brandIdFilter) {
      where.campaignInfluencer = {
        ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
        ...(brandIdFilter ? { campaign: { brandId: brandIdFilter } } : {}),
      };
    }

    const rows = await prisma.productShipment.findMany({
      where,
      include: {
        ...itemsInclude,
        campaignInfluencer: {
          select: {
            campaignId: true,
            campaign: { select: { id: true, name: true, brandId: true, brand: { select: { id: true, name: true } } } },
            influencer: { select: { id: true, displayName: true, avatarOverrideUrl: true, resolvedAvatarUrl: true } },
          },
        },
        deliverable: { select: { type: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > filter.limit;
    const page = rows.slice(0, filter.limit);
    const data: LogisticsRequestDTO[] = page.map((s) =>
      redact({
        ...toDTO(s),
        influencer: s.campaignInfluencer.influencer
          ? {
              id: s.campaignInfluencer.influencer.id,
              displayName: s.campaignInfluencer.influencer.displayName,
              avatarUrl: s.campaignInfluencer.influencer.avatarOverrideUrl ?? s.campaignInfluencer.influencer.resolvedAvatarUrl ?? null,
            }
          : null,
        brand: s.campaignInfluencer.campaign.brand,
        campaign: { id: s.campaignInfluencer.campaign.id, name: s.campaignInfluencer.campaign.name },
        deliverableType: s.deliverable?.type ?? null,
      }),
    );
    return { data, hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
  }

  async function create(campaignInfluencerId: string, input: ShipmentCreate): Promise<ProductShipmentDTO> {
    const actor = requireActor(ctx);
    const ci = await ciContext(campaignInfluencerId);

    // A deliverableId, if given, must belong to THIS campaign-influencer — the
    // same "never silently mismatch" discipline as resolveContentAssociation.
    if (input.deliverableId) {
      const deliverable = await prisma.deliverable.findUnique({
        where: { id: input.deliverableId },
        select: { campaignInfluencerId: true },
      });
      if (!deliverable) throw AppError.badRequest('That deliverable does not exist.');
      if (deliverable.campaignInfluencerId !== campaignInfluencerId) {
        throw AppError.conflict("That deliverable does not belong to this creator's campaign participation.");
      }
    }

    const now = new Date();
    const stamps = autoTimestamps(
      input.status,
      { shippedAt: null, deliveredAt: null },
      { shippedAt: input.shippedAt, deliveredAt: input.deliveredAt },
      now,
    );

    const created = await prisma.$transaction(async (tx) => {
      const shipment = await tx.productShipment.create({
        data: {
          campaignInfluencerId,
          deliverableId: input.deliverableId ?? null,
          status: input.status ?? 'PENDING',
          createdById: actor.id,
          recipientName: input.recipientName ?? null,
          phone: input.phone ?? null,
          addressLine1: input.addressLine1 ?? null,
          addressLine2: input.addressLine2 ?? null,
          city: input.city ?? null,
          country: input.country ?? null,
          postalCode: input.postalCode ?? null,
          deliveryInstructions: input.deliveryInstructions ?? null,
          courier: input.courier ?? null,
          trackingNumber: input.trackingNumber ?? null,
          trackingUrl: input.trackingUrl ?? null,
          notes: input.notes ?? null,
          shippedAt: input.shippedAt ?? stamps.shippedAt ?? null,
          deliveredAt: input.deliveredAt ?? stamps.deliveredAt ?? null,
        },
      });

      // Resolve each line item's Product by (brand, name) — auto-creating it
      // the first time a name is used, so staff never manage a separate
      // product-catalog screen (smallest reusable product architecture).
      for (const item of input.items) {
        const name = item.productName.trim();
        const product = await tx.product.upsert({
          where: { brandId_name: { brandId: ci.campaign.brandId, name } },
          create: { brandId: ci.campaign.brandId, name },
          update: {},
        });
        await tx.shipmentItem.create({
          data: {
            shipmentId: shipment.id,
            productId: product.id,
            sku: item.sku ?? null,
            variant: item.variant ?? null,
            quantity: item.quantity,
          },
        });
      }

      await logActivity(
        ctx,
        {
          type: 'GENERIC',
          message: `${actor.name} created a logistics request (${(input.status ?? 'PENDING').replace(/_/g, ' ').toLowerCase()}).`,
          brandId: ci.campaign.brandId,
          campaignId: ci.campaignId,
          influencerId: ci.influencerId,
          meta: { shipmentId: shipment.id, status: shipment.status, deliverableId: shipment.deliverableId },
        },
        tx,
      );

      return shipment;
    });

    return loadDTO(created.id);
  }

  /** Update fulfilment details (address, courier, tracking, notes) — never the campaignInfluencerId/deliverableId/items. */
  async function update(shipmentId: string, input: ShipmentUpdate): Promise<ProductShipmentDTO> {
    const actor = requireActor(ctx);
    const existing = await prisma.productShipment.findUnique({
      where: { id: shipmentId },
      include: { campaignInfluencer: { select: { campaignId: true, influencerId: true, campaign: { select: { brandId: true } } } } },
    });
    if (!existing) throw AppError.notFound('Shipment');
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, existing.campaignInfluencer.campaign.brandId)) throw AppError.notFound('Shipment');

    const now = new Date();
    const stamps = autoTimestamps(
      input.status,
      { shippedAt: existing.shippedAt, deliveredAt: existing.deliveredAt },
      { shippedAt: input.shippedAt, deliveredAt: input.deliveredAt },
      now,
    );
    const statusChanged = input.status != null && input.status !== existing.status;

    const row = await prisma.productShipment.update({
      where: { id: shipmentId },
      data: {
        recipientName: input.recipientName === undefined ? undefined : input.recipientName,
        phone: input.phone === undefined ? undefined : input.phone,
        addressLine1: input.addressLine1 === undefined ? undefined : input.addressLine1,
        addressLine2: input.addressLine2 === undefined ? undefined : input.addressLine2,
        city: input.city === undefined ? undefined : input.city,
        country: input.country === undefined ? undefined : input.country,
        postalCode: input.postalCode === undefined ? undefined : input.postalCode,
        deliveryInstructions: input.deliveryInstructions === undefined ? undefined : input.deliveryInstructions,
        courier: input.courier === undefined ? undefined : input.courier,
        trackingNumber: input.trackingNumber === undefined ? undefined : input.trackingNumber,
        trackingUrl: input.trackingUrl === undefined ? undefined : input.trackingUrl,
        notes: input.notes === undefined ? undefined : input.notes,
        status: input.status ?? undefined,
        ...stamps,
      },
      include: itemsInclude,
    });

    if (statusChanged) await notifyStatus(existing.campaignInfluencer, row, actor.name);
    return redact(toDTO(row));
  }

  async function updateStatus(shipmentId: string, input: ShipmentStatusInput): Promise<ProductShipmentDTO> {
    const actor = requireActor(ctx);
    const existing = await prisma.productShipment.findUnique({
      where: { id: shipmentId },
      include: { campaignInfluencer: { select: { campaignId: true, influencerId: true, campaign: { select: { brandId: true } } } } },
    });
    if (!existing) throw AppError.notFound('Shipment');
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, existing.campaignInfluencer.campaign.brandId)) throw AppError.notFound('Shipment');
    const now = new Date();
    const stamps = autoTimestamps(input.status, { shippedAt: existing.shippedAt, deliveredAt: existing.deliveredAt }, {}, now);

    const row = await prisma.productShipment.update({
      where: { id: shipmentId },
      data: { status: input.status, ...stamps },
      include: itemsInclude,
    });
    await notifyStatus(existing.campaignInfluencer, row, actor.name);
    return redact(toDTO(row));
  }

  /**
   * Two-way status visibility (WORKFLOW_GAP_MATRIX.md, Logistics → Campaign/
   * Influencer/Deliverable): logs the transition AND notifies, so a campaign
   * employee sees "Shipment: SHIPPED" the moment logistics sets it, without
   * anyone copying it by hand.
   */
  async function notifyStatus(
    ci: { campaignId: string; influencerId: string; campaign: { brandId: string } },
    shipment: { id: string; status: ShipmentStatus; deliverableId: string | null },
    actorName: string,
  ) {
    const label = shipment.status.replace(/_/g, ' ').toLowerCase();
    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actorName} marked a shipment ${label}.`,
      brandId: ci.campaign.brandId,
      campaignId: ci.campaignId,
      influencerId: ci.influencerId,
      meta: { shipmentId: shipment.id, status: shipment.status, deliverableId: shipment.deliverableId },
    });
    if (shipment.status === 'SHIPPED' || shipment.status === 'DELIVERED') {
      await createNotification(ctx, {
        category: 'GENERAL',
        title: `Shipment ${label}`,
        body: `A logistics request is now ${label}.`,
        targetUrl: `/campaigns/${ci.campaignId}`,
        brandId: ci.campaign.brandId,
        campaignId: ci.campaignId,
        influencerId: ci.influencerId,
      });
    }
  }

  return { get: loadDTO, listForCampaignInfluencer, listForDeliverable, listForCampaign, listAll, create, update, updateStatus };
}

export type ShipmentService = ReturnType<typeof makeShipmentService>;
