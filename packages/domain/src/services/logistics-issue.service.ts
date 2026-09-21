import { requests, type LogisticsIssueDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor, requireCapability } from '../lib/authz';
import { hasCapability } from '../lib/capabilities';
import { createNotification, logActivity } from '../lib/helpers';
import { isBrandOutOfScope, isCountryOutOfScope, scopedBrandIds, scopedCountryCodes } from '../lib/scope';

type IssueCreate = z.infer<typeof requests.logisticsIssueCreateSchema>;

const include = {
  createdBy: { select: { name: true } },
  assignedTo: { select: { name: true } },
  resolvedBy: { select: { name: true } },
} satisfies Prisma.LogisticsIssueInclude;

type Row = Prisma.LogisticsIssueGetPayload<{ include: typeof include }>;

function toDTO(row: Row): LogisticsIssueDTO {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    type: row.type,
    status: row.status,
    description: row.description,
    createdById: row.createdById,
    createdByName: row.createdBy?.name ?? null,
    assignedToUserId: row.assignedToUserId,
    assignedToName: row.assignedTo?.name ?? null,
    resolvedById: row.resolvedById,
    resolvedByName: row.resolvedBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

/**
 * Address Clarification workflow (Advanced Roles & Logistics Operations
 * pass) — a shipment stays whatever ShipmentStatus it really is (often still
 * PENDING) while an OPEN LogisticsIssue is the thing that actually blocks
 * fulfilment. Deliberately scoped to exactly one shipment with a fixed type
 * vocabulary — never a general-purpose issue tracker. Surfaced from ONE
 * record on every relevant screen (Logistics, Influencer 360, Campaign
 * Operations, Needs Attention) via the same shipment query's `openIssue`
 * field — never copied.
 */
export function makeLogisticsIssueService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function shipmentContext(shipmentId: string) {
    const shipment = await prisma.productShipment.findUnique({
      where: { id: shipmentId },
      include: {
        campaignInfluencer: {
          select: { campaignId: true, influencerId: true, campaign: { select: { brandId: true, ownerId: true } } },
        },
      },
    });
    if (!shipment) throw AppError.notFound('Shipment');
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, shipment.campaignInfluencer.campaign.brandId)) throw AppError.notFound('Shipment');
    // Country scope (Advanced Roles pass) composes with brand scope — same
    // direct-ID posture as shipment.service.ts itself: a country-scoped
    // actor can never list/create an issue on an out-of-scope shipment by
    // guessing its id, not merely have it hidden in a filtered list.
    const countryScope = await scopedCountryCodes(ctx);
    if (isCountryOutOfScope(countryScope, shipment.destinationCountryCode)) throw AppError.notFound('Shipment');
    return shipment;
  }

  async function list(shipmentId: string): Promise<LogisticsIssueDTO[]> {
    await shipmentContext(shipmentId);
    const rows = await prisma.logisticsIssue.findMany({ where: { shipmentId }, include, orderBy: { createdAt: 'desc' } });
    return rows.map(toDTO);
  }

  /**
   * Picks the responsible employee to notify — never a broadcast. Priority:
   * an explicit choice, then the campaign owner, then the creator's
   * relationship owner, then whoever originally requested the shipment.
   */
  async function resolveResponsibleUserId(
    shipment: Awaited<ReturnType<typeof shipmentContext>>,
    explicit: string | null | undefined,
  ): Promise<string | null> {
    if (explicit) return explicit;
    // Security & Authorization Freeze Gate, section 10/17 — this campaignId
    // is NOT a fresh, attacker-controlled input: `shipment` is only ever the
    // return value of `shipmentContext()` (its only caller is `create()`,
    // right after `await shipmentContext(shipmentId)`), which has already
    // brand- and country-scope-checked this exact campaign via
    // `shipment.campaignInfluencer.campaign.brandId`. A second scope check
    // here would be redundant, not defensive — reaching for `ownerId` (not
    // selected by shipmentContext) needs its own lookup, but not its own gate.
    const campaign = await prisma.campaign.findUnique({
      where: { id: shipment.campaignInfluencer.campaignId },
      select: { ownerId: true },
    });
    if (campaign?.ownerId) return campaign.ownerId;
    const influencer = await prisma.influencer.findUnique({
      where: { id: shipment.campaignInfluencer.influencerId },
      select: { ownerId: true },
    });
    if (influencer?.ownerId) return influencer.ownerId;
    return shipment.createdById;
  }

  async function create(shipmentId: string, input: IssueCreate): Promise<LogisticsIssueDTO> {
    const actor = await requireCapability(ctx, 'LOGISTICS_ISSUE_MANAGE');
    const shipment = await shipmentContext(shipmentId);
    const responsibleId = await resolveResponsibleUserId(shipment, input.assignedToUserId);

    const row = await prisma.logisticsIssue.create({
      data: {
        shipmentId,
        type: input.type,
        description: input.description,
        createdById: actor.id,
        assignedToUserId: responsibleId,
      },
      include,
    });

    const { campaignId, influencerId, campaign } = shipment.campaignInfluencer;
    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} requested address clarification for a shipment.`,
      brandId: campaign.brandId,
      campaignId,
      influencerId,
      meta: { shipmentId, logisticsIssueId: row.id, event: 'issue_opened', issueType: input.type },
    });

    if (responsibleId) {
      const influencer = await prisma.influencer.findUnique({ where: { id: influencerId }, select: { displayName: true } });
      // Deliberately no address/phone in the body — deep-link to the
      // protected detail instead (never leak PII through a notification).
      await createNotification(ctx, {
        category: 'LOGISTICS_ADDRESS_ISSUE',
        title: 'Address clarification needed',
        body: `Logistics needs address clarification for ${influencer?.displayName ?? 'a creator'}.`,
        targetUrl: `/influencers/${influencerId}`,
        userId: responsibleId,
        brandId: campaign.brandId,
        campaignId,
        influencerId,
      });
    }

    return toDTO(row);
  }

  async function loadWithScope(issueId: string) {
    const existing = await prisma.logisticsIssue.findUnique({
      where: { id: issueId },
      include: {
        ...include,
        shipment: {
          select: {
            id: true,
            destinationCountryCode: true,
            campaignInfluencer: { select: { campaignId: true, influencerId: true, campaign: { select: { brandId: true } } } },
          },
        },
      },
    });
    if (!existing) throw AppError.notFound('Logistics issue');
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, existing.shipment.campaignInfluencer.campaign.brandId)) throw AppError.notFound('Logistics issue');
    const countryScope = await scopedCountryCodes(ctx);
    if (isCountryOutOfScope(countryScope, existing.shipment.destinationCountryCode)) throw AppError.notFound('Logistics issue');
    return existing;
  }

  async function requireResolvePermission(actorId: string, existing: { assignedToUserId: string | null; createdById: string | null }) {
    const canManage = await hasCapability(ctx, 'LOGISTICS_ISSUE_MANAGE');
    if (canManage) return;
    if (existing.assignedToUserId === actorId || existing.createdById === actorId) return;
    throw AppError.forbidden('Only the responsible employee or logistics can act on this issue.');
  }

  async function resolve(issueId: string): Promise<LogisticsIssueDTO> {
    const actor = requireActor(ctx);
    const existing = await loadWithScope(issueId);
    if (existing.status !== 'OPEN') throw AppError.conflict('This issue is already closed.');
    await requireResolvePermission(actor.id, existing);

    const row = await prisma.logisticsIssue.update({
      where: { id: issueId },
      data: { status: 'RESOLVED', resolvedById: actor.id, resolvedAt: new Date() },
      include,
    });
    const { campaignId, influencerId, campaign } = existing.shipment.campaignInfluencer;
    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} resolved a logistics address clarification.`,
      brandId: campaign.brandId,
      campaignId,
      influencerId,
      meta: { shipmentId: existing.shipmentId, logisticsIssueId: issueId, event: 'issue_resolved' },
    });
    return toDTO(row);
  }

  async function cancel(issueId: string): Promise<LogisticsIssueDTO> {
    const actor = requireActor(ctx);
    const existing = await loadWithScope(issueId);
    if (existing.status !== 'OPEN') throw AppError.conflict('This issue is already closed.');
    await requireResolvePermission(actor.id, existing);

    const row = await prisma.logisticsIssue.update({
      where: { id: issueId },
      data: { status: 'CANCELLED', resolvedById: actor.id, resolvedAt: new Date() },
      include,
    });
    const { campaignId, influencerId, campaign } = existing.shipment.campaignInfluencer;
    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} cancelled a logistics address clarification.`,
      brandId: campaign.brandId,
      campaignId,
      influencerId,
      meta: { shipmentId: existing.shipmentId, logisticsIssueId: issueId, event: 'issue_cancelled' },
    });
    return toDTO(row);
  }

  return { list, create, resolve, cancel };
}

export type LogisticsIssueService = ReturnType<typeof makeLogisticsIssueService>;
