import type { CreatorLogisticsState } from '@influenceos/contracts';
import type { Prisma } from '@influenceos/database';

/**
 * When a creator on a campaign should receive the brand's products — the one
 * rule every surface reads (roster row, campaign board, Logistics, Needs
 * Attention, My work, the automatic shipment request), so they never
 * disagree.
 *
 * A creator gets products when any of these holds:
 *   - their deal includes a gift (GIFTED_PRODUCT or PAID_PLUS_GIFTED);
 *   - the campaign is marked "creators receive products";
 *   - one of their (not cancelled) deliverables needs the product.
 * It matters once they are committed (CONFIRMED or IN_PROGRESS): an invited
 * creator hasn't agreed yet, and a finished or dropped one needs nothing new.
 */

export const PRODUCT_DEALS = ['GIFTED_PRODUCT', 'PAID_PLUS_GIFTED'] as const;
export const COMMITTED_STATUSES = ['CONFIRMED', 'IN_PROGRESS'] as const;
/** Campaigns whose creators can still be waiting for products. */
export const LIVE_CAMPAIGN_STATUSES = ['DRAFT', 'PLANNING', 'ACTIVE', 'PAUSED'] as const;

export type ProductReason = 'DEAL' | 'CAMPAIGN' | 'DELIVERABLE';

export interface ProductNeedInput {
  dealType: string;
  participationStatus: string;
  campaign: { shipsProducts: boolean };
  deliverables: { requiresProduct: boolean }[];
}

/** Why this creator gets products, or null when they don't. */
export function productReason(
  ci: Omit<ProductNeedInput, 'participationStatus'>,
): ProductReason | null {
  if ((PRODUCT_DEALS as readonly string[]).includes(ci.dealType)) return 'DEAL';
  if (ci.campaign.shipsProducts) return 'CAMPAIGN';
  if (ci.deliverables.some((d) => d.requiresProduct)) return 'DELIVERABLE';
  return null;
}

export function isCommitted(participationStatus: string): boolean {
  return (COMMITTED_STATUSES as readonly string[]).includes(participationStatus);
}

/** A committed creator who gets products. */
export function needsProduct(ci: ProductNeedInput): boolean {
  return isCommitted(ci.participationStatus) && productReason(ci) !== null;
}

/** The same rule as a query: committed creators on live campaigns who get products. */
export const needsProductWhere: Prisma.CampaignInfluencerWhereInput = {
  participationStatus: { in: [...COMMITTED_STATUSES] },
  campaign: { status: { in: [...LIVE_CAMPAIGN_STATUSES] } },
  OR: [
    { dealType: { in: [...PRODUCT_DEALS] } },
    { campaign: { shipsProducts: true } },
    { deliverables: { some: { requiresProduct: true, status: { not: 'CANCELLED' } } } },
  ],
};

/** …who have no shipment at all yet: nothing has been asked of Logistics. */
export const awaitingShipmentWhere: Prisma.CampaignInfluencerWhereInput = {
  AND: [needsProductWhere, { shipments: { none: {} } }],
};

export interface LogisticsShipmentInput {
  status: string;
  addressLine1: string | null;
  phone: string | null;
  hasOpenIssue: boolean;
}

/**
 * One word for where a creator's products stand (the roster badge and the
 * board's Product stage). The worst thing wins: an open address issue or a
 * failed / returned parcel with nothing else on the way is a problem even if
 * an older shipment arrived.
 */
export function logisticsState(
  reason: ProductReason | null,
  shipments: LogisticsShipmentInput[],
): CreatorLogisticsState {
  if (shipments.length === 0) return reason ? 'NEEDED' : 'NOT_NEEDED';
  if (shipments.some((s) => s.hasOpenIssue)) return 'PROBLEM';
  const active = shipments.filter((s) => s.status !== 'FAILED' && s.status !== 'RETURNED');
  if (active.length === 0) return 'PROBLEM';
  const pending = active.filter((s) => s.status === 'PENDING');
  if (pending.some((s) => !s.addressLine1 || !s.phone)) return 'ADDRESS_MISSING';
  if (pending.length > 0) return 'REQUESTED';
  if (active.some((s) => s.status === 'SHIPPED' || s.status === 'IN_TRANSIT')) return 'ON_THE_WAY';
  return 'DELIVERED';
}
