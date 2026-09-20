import { type Prisma, type PrismaClient } from '@influenceos/database';
import { AppError } from '../errors';
import { isBrandOutOfScope } from './scope';

// Re-exported so every consumer of this file can reach the derived status
// label from one place, without a second import — the actual logic lives in
// @influenceos/shared because it must also run client-side (Live Content
// filters, Content Detail page) with no database access.
export { contentAssociationStatus, type ContentAssociationStatus } from '@influenceos/shared';

export interface AssociationInput {
  brandId?: string | null;
  campaignId?: string | null;
  influencerId?: string | null;
  campaignInfluencerId?: string | null;
  deliverableId?: string | null;
}

export interface ResolvedAssociation {
  brandId: string | null;
  campaignId: string | null;
  influencerId: string | null;
  campaignInfluencerId: string | null;
  deliverableId: string | null;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The single source of truth for how content (and any future association
 * consumer) resolves and validates brand/campaign/influencer/
 * campaignInfluencer/deliverable relationships. Callers (content.service.ts
 * create/update today; Quick Add and the Influencer/Campaign/Deliverable
 * "Add Content" entry points all go through those same two functions, not
 * this file directly) must never re-derive or re-validate these relationships
 * themselves — that is exactly the drift this resolver exists to prevent.
 *
 * Precedence — the most specific supplied id is the "anchor" and its own
 * relationship chain is authoritative. Any other explicitly-supplied id that
 * disagrees with the anchor's chain is a conflict and is rejected (never
 * silently overwritten, never silently discarded):
 *   1. deliverableId given -> Deliverable -> CampaignInfluencer -> Campaign -> Brand.
 *   2. else campaignInfluencerId given -> CampaignInfluencer -> Campaign -> Brand.
 *   3. else campaignId AND influencerId both given -> that pair must already be on
 *      the campaign roster (a CampaignInfluencer row must exist for it); if not,
 *      reject with guidance instead of saving a mismatched pair.
 *   4. else whatever subset of brandId/campaignId/influencerId was given passes
 *      through as-is — this is what makes influencer-only content, campaign-only
 *      content, and fully-unassigned content possible. brandId is backfilled from
 *      campaignId when known and not supplied.
 *
 * `scope` is a brand-scoped actor's allowed brand ids (from
 * `scopedBrandIds(ctx)`), or null when unscoped (admin/system). Whenever the
 * resolution touches a real brand, it is checked against this scope — a
 * scoped operator can never create, derive, or re-link content into a brand
 * outside their access (WORKFLOW_GAP_MATRIX.md, "Permissions/privacy").
 */
export async function resolveContentAssociation(
  db: Db,
  input: AssociationInput,
  scope: string[] | null = null,
): Promise<ResolvedAssociation> {
  const given: Required<AssociationInput> = {
    brandId: input.brandId ?? null,
    campaignId: input.campaignId ?? null,
    influencerId: input.influencerId ?? null,
    campaignInfluencerId: input.campaignInfluencerId ?? null,
    deliverableId: input.deliverableId ?? null,
  };

  function assertInScope(brandId: string | null): void {
    if (brandId && isBrandOutOfScope(scope, brandId)) {
      throw AppError.forbidden('You do not have access to this brand.');
    }
  }

  // 1. Deliverable — most specific anchor, fixed; everything else derives from it.
  if (given.deliverableId) {
    const deliverable = await db.deliverable.findUnique({
      where: { id: given.deliverableId },
      include: { campaignInfluencer: { include: { campaign: { select: { id: true, brandId: true } } } } },
    });
    if (!deliverable) throw AppError.badRequest('That deliverable does not exist.');
    const ci = deliverable.campaignInfluencer;
    const anchor: ResolvedAssociation = {
      deliverableId: deliverable.id,
      campaignInfluencerId: ci.id,
      campaignId: ci.campaignId,
      influencerId: ci.influencerId,
      brandId: ci.campaign.brandId,
    };
    if (given.campaignInfluencerId && given.campaignInfluencerId !== anchor.campaignInfluencerId) {
      throw AppError.conflict("The supplied campaign participation does not match this deliverable's own campaign/influencer.");
    }
    if (given.campaignId && given.campaignId !== anchor.campaignId) {
      throw AppError.conflict("The supplied campaign does not match this deliverable's campaign.");
    }
    if (given.influencerId && given.influencerId !== anchor.influencerId) {
      throw AppError.conflict("The supplied influencer does not match this deliverable's influencer.");
    }
    if (given.brandId && given.brandId !== anchor.brandId) {
      throw AppError.conflict("The supplied brand does not match this deliverable's brand.");
    }
    assertInScope(anchor.brandId);
    return anchor;
  }

  // 2. CampaignInfluencer — a specific roster row, next most specific anchor.
  if (given.campaignInfluencerId) {
    const ci = await db.campaignInfluencer.findUnique({
      where: { id: given.campaignInfluencerId },
      include: { campaign: { select: { id: true, brandId: true } } },
    });
    if (!ci) throw AppError.badRequest('That campaign participation does not exist.');
    const anchor: ResolvedAssociation = {
      deliverableId: null,
      campaignInfluencerId: ci.id,
      campaignId: ci.campaignId,
      influencerId: ci.influencerId,
      brandId: ci.campaign.brandId,
    };
    if (given.campaignId && given.campaignId !== anchor.campaignId) {
      throw AppError.conflict('The supplied campaign does not match this campaign participation.');
    }
    if (given.influencerId && given.influencerId !== anchor.influencerId) {
      throw AppError.conflict('The supplied influencer does not match this campaign participation.');
    }
    if (given.brandId && given.brandId !== anchor.brandId) {
      throw AppError.conflict('The supplied brand does not match this campaign participation.');
    }
    assertInScope(anchor.brandId);
    return anchor;
  }

  // 3. Campaign + influencer given directly: the pair must already be on the
  //    roster together. Never silently save a mismatched/implied pair (SCENARIO F/E).
  if (given.campaignId && given.influencerId) {
    const ci = await db.campaignInfluencer.findUnique({
      where: { campaignId_influencerId: { campaignId: given.campaignId, influencerId: given.influencerId } },
      include: { campaign: { select: { id: true, brandId: true } } },
    });
    if (!ci) {
      throw AppError.conflict(
        "This influencer is not on that campaign's roster yet. Add them to the campaign first, or leave the campaign blank to save this as independent content.",
      );
    }
    if (given.brandId && given.brandId !== ci.campaign.brandId) {
      throw AppError.conflict('The supplied brand does not match the campaign.');
    }
    assertInScope(ci.campaign.brandId);
    return {
      deliverableId: null,
      campaignInfluencerId: ci.id,
      campaignId: ci.campaignId,
      influencerId: ci.influencerId,
      brandId: ci.campaign.brandId,
    };
  }

  // 4. Whatever subset was given passes through — influencer-only, campaign-only,
  //    or fully-unassigned content, all valid. Still existence-checked.
  let brandId = given.brandId;
  if (given.campaignId) {
    const campaign = await db.campaign.findUnique({ where: { id: given.campaignId }, select: { brandId: true } });
    if (!campaign) throw AppError.badRequest('That campaign does not exist.');
    if (brandId && brandId !== campaign.brandId) {
      throw AppError.conflict("The supplied brand does not match the supplied campaign's brand.");
    }
    brandId = brandId ?? campaign.brandId;
  }
  if (given.influencerId) {
    const influencer = await db.influencer.findUnique({ where: { id: given.influencerId }, select: { id: true } });
    if (!influencer) throw AppError.badRequest('That influencer does not exist.');
  }
  if (!given.campaignId && given.brandId) {
    const brand = await db.brand.findUnique({ where: { id: given.brandId }, select: { id: true } });
    if (!brand) throw AppError.badRequest('That brand does not exist.');
  }
  assertInScope(brandId);

  return {
    deliverableId: null,
    campaignInfluencerId: null,
    campaignId: given.campaignId,
    influencerId: given.influencerId,
    brandId,
  };
}
