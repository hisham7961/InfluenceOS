import {
  buildOffsetPagination,
  type CursorPage,
  type ShipmentAwaitingDTO,
} from '@influenceos/contracts';
import type { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireAnyCapability } from '../lib/authz';
import { createNotification, logActivity } from '../lib/helpers';
import {
  isBrandOutOfScope,
  isCountryOutOfScope,
  scopedBrandIds,
  scopedCountryCodes,
} from '../lib/scope';
import {
  LIVE_CAMPAIGN_STATUSES,
  awaitingShipmentWhere,
  isCommitted,
  productReason,
} from '../lib/shipment-needs';

const rowSelect = {
  id: true,
  campaignId: true,
  influencerId: true,
  dealType: true,
  participationStatus: true,
  campaign: { select: { brandId: true, name: true, status: true, shipsProducts: true } },
  deliverables: { where: { status: { not: 'CANCELLED' } }, select: { requiresProduct: true } },
  influencer: {
    select: {
      displayName: true,
      countryCode: true,
      country: true,
      city: true,
      mobile: true,
      addressLine1: true,
      addressLine2: true,
      postalCode: true,
      deliveryInstructions: true,
    },
  },
  shipments: {
    select: {
      id: true,
      autoCreated: true,
      status: true,
      courier: true,
      trackingNumber: true,
      _count: { select: { items: true, issues: true, comments: true } },
    },
  },
} satisfies Prisma.CampaignInfluencerSelect;

type Row = Prisma.CampaignInfluencerGetPayload<{ select: typeof rowSelect }>;

/** A request the app created that nobody has started on — safe to take back. */
function untouched(s: Row['shipments'][number]): boolean {
  return (
    s.autoCreated &&
    s.status === 'PENDING' &&
    !s.courier &&
    !s.trackingNumber &&
    s._count.items === 0 &&
    s._count.issues === 0 &&
    s._count.comments === 0
  );
}

/**
 * Shipment requests that follow the roster (the missing link between "the
 * creator is confirmed" and "Logistics has something to send").
 *
 * When a creator who gets products (lib/shipment-needs.ts) becomes committed,
 * a PENDING shipment request appears in Logistics with their address copied
 * from their profile — nobody has to remember to create it. If the only
 * logistics person who covers that brand and country can be told apart, it is
 * assigned to them. If the creator later drops out or no longer gets
 * products, a request nobody has started on is taken back again; one that
 * Logistics already worked on stays for them to close.
 *
 * sync() is called by the roster, the campaign switch and deliverable edits
 * after their own authorization — it acts for the app, not for the person,
 * so a campaign manager without logistics rights still gets the request made.
 */
export function makeShipmentRequestService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function defaultAssignee(
    brandId: string,
    countryCode: string | null,
  ): Promise<string | null> {
    const people = await prisma.user.findMany({
      where: { isActive: true, roleProfile: 'LOGISTICS' },
      select: {
        id: true,
        brandAccess: { select: { brandId: true } },
        countryAccess: { select: { countryCode: true } },
      },
    });
    const fit = people.filter(
      (u) =>
        (u.brandAccess.length === 0 || u.brandAccess.some((b) => b.brandId === brandId)) &&
        (u.countryAccess.length === 0 ||
          (countryCode != null && u.countryAccess.some((c) => c.countryCode === countryCode))),
    );
    return fit.length === 1 ? fit[0]!.id : null;
  }

  async function createRequest(row: Row, source: 'auto' | 'manual'): Promise<string> {
    const inf = row.influencer;
    const assignee = await defaultAssignee(row.campaign.brandId, inf.countryCode);
    const shipment = await prisma.$transaction(async (tx) => {
      const created = await tx.productShipment.create({
        data: {
          campaignInfluencerId: row.id,
          status: 'PENDING',
          autoCreated: true,
          createdById: ctx.actor?.id ?? null,
          assignedToUserId: assignee,
          recipientName: inf.displayName,
          phone: inf.mobile,
          addressLine1: inf.addressLine1,
          addressLine2: inf.addressLine2,
          city: inf.city,
          country: inf.country,
          postalCode: inf.postalCode,
          deliveryInstructions: inf.deliveryInstructions,
          destinationCountryCode: inf.countryCode,
        },
      });
      await logActivity(
        ctx,
        {
          type: 'GENERIC',
          message:
            source === 'manual'
              ? `${ctx.actor?.name ?? 'Someone'} asked Logistics to send products to ${inf.displayName}.`
              : `A shipment request for ${inf.displayName} was added to Logistics.`,
          brandId: row.campaign.brandId,
          campaignId: row.campaignId,
          influencerId: row.influencerId,
          meta: { shipmentId: created.id, event: 'shipment_request', source },
        },
        tx,
      );
      // The one logistics person who covers it hears about it straight away;
      // otherwise it waits under "Unassigned" (and on their My work).
      if (assignee) {
        await createNotification(
          ctx,
          {
            category: 'GENERAL',
            userId: assignee,
            title: 'New shipment request',
            body: `Send products to ${inf.displayName} for ${row.campaign.name}.`,
            targetUrl: '/logistics?assigneeId=me&status=PENDING',
            brandId: row.campaign.brandId,
            campaignId: row.campaignId,
            influencerId: row.influencerId,
          },
          tx,
        );
      }
      return created;
    });
    return shipment.id;
  }

  /**
   * Bring these roster rows' shipment requests in line with the rule:
   * create one for a committed creator on a live campaign who gets products
   * and has none; take back untouched automatic ones from a creator who no
   * longer needs them. Safe to call as often as you like.
   */
  async function sync(
    campaignInfluencerIds: string[],
  ): Promise<{ created: number; removed: number }> {
    const result = { created: 0, removed: 0 };
    if (campaignInfluencerIds.length === 0) return result;
    const rows = await prisma.campaignInfluencer.findMany({
      where: { id: { in: campaignInfluencerIds } },
      select: rowSelect,
    });
    for (const row of rows) {
      const gets = productReason(row) !== null;
      const committed = isCommitted(row.participationStatus);
      const live = (LIVE_CAMPAIGN_STATUSES as readonly string[]).includes(row.campaign.status);
      if (gets && committed) {
        if (live && row.shipments.length === 0) {
          await createRequest(row, 'auto');
          result.created += 1;
        }
        continue;
      }
      const stale = row.shipments.filter(untouched);
      if (stale.length === 0) continue;
      await prisma.$transaction(async (tx) => {
        await tx.productShipment.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
        await logActivity(
          ctx,
          {
            type: 'GENERIC',
            message: `The shipment request for ${row.influencer.displayName} was taken back — they no longer get products.`,
            brandId: row.campaign.brandId,
            campaignId: row.campaignId,
            influencerId: row.influencerId,
            meta: { event: 'shipment_request_removed', shipmentIds: stale.map((s) => s.id) },
          },
          tx,
        );
      });
      result.removed += stale.length;
    }
    return result;
  }

  /** Every roster row of a campaign — after the campaign's own settings changed. */
  async function syncCampaign(campaignId: string) {
    const ids = await prisma.campaignInfluencer.findMany({
      where: { campaignId },
      select: { id: true },
    });
    return sync(ids.map((r) => r.id));
  }

  /**
   * "Ask Logistics to send products" from a roster row or a waiting list.
   * Whoever manages the campaign, its creators or logistics may ask; the
   * request is the same automatic kind (address copied, assignee picked).
   * An open request that already exists is returned instead of a second one.
   */
  async function request(
    campaignInfluencerId: string,
  ): Promise<{ shipmentId: string; created: boolean }> {
    await requireAnyCapability(ctx, ['CAMPAIGNS_MANAGE', 'INFLUENCERS_MANAGE', 'LOGISTICS_MANAGE']);
    const row = await prisma.campaignInfluencer.findUnique({
      where: { id: campaignInfluencerId },
      select: rowSelect,
    });
    if (!row) throw AppError.notFound('Campaign influencer');
    const brandScope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(brandScope, row.campaign.brandId))
      throw AppError.notFound('Campaign influencer');
    const countryScope = await scopedCountryCodes(ctx);
    if (isCountryOutOfScope(countryScope, row.influencer.countryCode))
      throw AppError.notFound('Campaign influencer');
    const open = await prisma.productShipment.findFirst({
      where: { campaignInfluencerId, status: 'PENDING' },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (open) return { shipmentId: open.id, created: false };
    return { shipmentId: await createRequest(row, 'manual'), created: true };
  }

  /** Scope: the brands and creator countries this person may see. */
  async function scopeWhere(): Promise<Prisma.CampaignInfluencerWhereInput[]> {
    const and: Prisma.CampaignInfluencerWhereInput[] = [];
    const brands = await scopedBrandIds(ctx);
    if (brands) and.push({ campaign: { brandId: { in: brands } } });
    const countries = await scopedCountryCodes(ctx);
    if (countries) and.push({ influencer: { countryCode: { in: countries } } });
    return and;
  }

  /**
   * Committed creators who get products but have no shipment at all yet —
   * the red "waiting for a shipment" list (Logistics page, campaign
   * Shipments tab), newest first.
   */
  async function awaiting(
    filter: { campaignId?: string; brandId?: string; limit?: number; page?: number } = {},
  ): Promise<CursorPage<ShipmentAwaitingDTO>> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);
    const page = Math.max(filter.page ?? 1, 1);
    const where: Prisma.CampaignInfluencerWhereInput = {
      AND: [
        awaitingShipmentWhere,
        ...(await scopeWhere()),
        ...(filter.campaignId ? [{ campaignId: filter.campaignId }] : []),
        ...(filter.brandId ? [{ campaign: { brandId: filter.brandId } }] : []),
      ],
    };
    const [total, rows] = await Promise.all([
      prisma.campaignInfluencer.count({ where }),
      prisma.campaignInfluencer.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          campaignId: true,
          dealType: true,
          participationStatus: true,
          updatedAt: true,
          campaign: {
            select: {
              name: true,
              brandId: true,
              shipsProducts: true,
              brand: { select: { name: true } },
            },
          },
          deliverables: {
            where: { status: { not: 'CANCELLED' } },
            select: { requiresProduct: true },
          },
          influencer: {
            select: {
              id: true,
              displayName: true,
              avatarOverrideUrl: true,
              resolvedAvatarUrl: true,
              socialAccounts: { select: { avatarUrl: true, isPrimary: true } },
              countryCode: true,
              addressLine1: true,
              mobile: true,
            },
          },
        },
      }),
    ]);
    const data: ShipmentAwaitingDTO[] = rows.map((r) => ({
      campaignInfluencerId: r.id,
      campaignId: r.campaignId,
      campaignName: r.campaign.name,
      brandId: r.campaign.brandId,
      brandName: r.campaign.brand.name,
      influencer: {
        id: r.influencer.id,
        displayName: r.influencer.displayName,
        avatarUrl:
          r.influencer.avatarOverrideUrl ??
          r.influencer.resolvedAvatarUrl ??
          (r.influencer.socialAccounts.find((a) => a.isPrimary) ?? r.influencer.socialAccounts[0])
            ?.avatarUrl ??
          null,
        countryCode: r.influencer.countryCode,
      },
      dealType: r.dealType,
      participationStatus: r.participationStatus,
      reason: productReason(r) ?? 'DEAL',
      addressOnFile: Boolean(r.influencer.addressLine1 && r.influencer.mobile),
      since: r.updatedAt.toISOString(),
    }));
    return {
      data,
      nextCursor: null,
      hasMore: page * limit < total,
      pagination: buildOffsetPagination(page, limit, total),
    };
  }

  /** How many creators are waiting for a shipment, in scope (sidebar, Needs Attention). */
  async function awaitingCount(extra: Prisma.CampaignInfluencerWhereInput = {}): Promise<number> {
    return prisma.campaignInfluencer.count({
      where: { AND: [awaitingShipmentWhere, ...(await scopeWhere()), extra] },
    });
  }

  return { sync, syncCampaign, request, awaiting, awaitingCount };
}
