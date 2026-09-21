import { type IntegrityFindingDTO, type IntegrityRuleId } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { requireActor } from '../lib/authz';
import { scopedBrandIds } from '../lib/scope';

// The same "direct-publish skips formal review" split documented in
// campaign-operations.service.ts and analytics.service.ts: a deliverable can
// reach a done state either via AWAITING_PUBLICATION (no submission ever
// required) or via the submission review path. Both count as "finished" for
// the rules below.
const DONE_DELIVERABLE_STATUSES = ['PUBLISHED', 'VERIFIED'] as const;
const TERMINAL_DELIVERABLE_STATUSES = new Set(['PUBLISHED', 'VERIFIED', 'MISSED', 'CANCELLED']);
const APPROVED_OR_LATER = new Set(['APPROVED', 'AWAITING_PUBLICATION', 'PUBLISHED', 'VERIFIED']);

function mkFinding(
  rule: IntegrityRuleId,
  entityId: string,
  severity: IntegrityFindingDTO['severity'],
  title: string,
  evidence: string,
  link: string,
  now: string,
): IntegrityFindingDTO {
  return { id: `${rule}:${entityId}`, rule, severity, title, evidence, link, detectedAt: now };
}

/**
 * Workflow Integrity Guard (Operations Intelligence pass, OI-9) — a read-only
 * relational-consistency sweep across the entities the content-association
 * and submission-review write paths are supposed to keep in sync. It never
 * repairs anything; it only surfaces rows where that invariant appears to
 * have slipped (a direct DB edit, a bug, or a race), each backed by the
 * actual mismatched values, never a guess.
 */
export function makeIntegrityGuardService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function effectiveBrandIds(brandId?: string): Promise<string[] | null> {
    const scope = await scopedBrandIds(ctx);
    if (!brandId) return scope;
    if (scope && !scope.includes(brandId)) return [];
    return [brandId];
  }

  async function findings(brandId?: string): Promise<IntegrityFindingDTO[]> {
    requireActor(ctx);
    const brandIds = await effectiveBrandIds(brandId);
    if (brandIds && brandIds.length === 0) return [];

    const now = new Date().toISOString();
    const campaignBrandWhere = brandIds ? { brandId: { in: brandIds } } : {};
    const out: IntegrityFindingDTO[] = [];

    // Rules 1-7 read disjoint tables/filters off the same `brandIds` scope —
    // no rule depends on another's result, so run them concurrently rather
    // than as six sequential round trips (mirrors data-quality.service.ts's
    // report(), and halves this endpoint's exposure to a single slow query
    // or transient stall turning into a cumulative multi-query timeout).
    const [contentRows, productDeliverables, deliverablesWithApproval, completedCampaigns, overpaid, usageRights] = await Promise.all([
      // Rules 1 & 2: content associated to a deliverable, but the content's
      // own campaign/influencer tag disagrees with the deliverable's actual
      // roster row. WF-6 enforces this at write time going forward; this
      // catches anything that predates that, or slipped through another path.
      prisma.publishedContent.findMany({
        where: { deliverableId: { not: null }, ...(brandIds ? { brandId: { in: brandIds } } : {}) },
        select: {
          id: true,
          originalUrl: true,
          campaignId: true,
          influencerId: true,
          campaign: { select: { name: true } },
          influencer: { select: { displayName: true } },
          deliverable: {
            select: {
              campaignInfluencer: {
                select: {
                  campaignId: true,
                  influencerId: true,
                  campaign: { select: { name: true } },
                  influencer: { select: { displayName: true } },
                },
              },
            },
          },
        },
      }),
      // Rule 3: a deliverable that required shipping a product has reached a
      // done state, but no shipment tied to it ever reached DELIVERED.
      prisma.deliverable.findMany({
        where: {
          requiresProduct: true,
          status: { in: [...DONE_DELIVERABLE_STATUSES] },
          campaignInfluencer: { campaign: campaignBrandWhere },
        },
        select: {
          id: true,
          platform: true,
          status: true,
          shipments: { select: { status: true } },
          campaignInfluencer: { select: { campaign: { select: { name: true } }, influencer: { select: { displayName: true } } } },
        },
      }),
      // Rule 4: the latest submission on a deliverable was approved, but the
      // deliverable's own status was never advanced to reflect that — the
      // transactional update in submission.service.ts's approve() step should
      // always keep these in lockstep, so a mismatch here means something
      // outside that path touched one side only.
      prisma.deliverable.findMany({
        where: {
          submissions: { some: { status: 'APPROVED' } },
          campaignInfluencer: { campaign: campaignBrandWhere },
        },
        select: {
          id: true,
          status: true,
          platform: true,
          campaignInfluencer: { select: { campaign: { select: { name: true } }, influencer: { select: { displayName: true } } } },
          submissions: { orderBy: { version: 'desc' }, take: 1, select: { status: true, version: true } },
        },
      }),
      // Rule 5: a campaign marked COMPLETED still has deliverables sitting in
      // a non-terminal state — the campaign says the work is done, the
      // roster says otherwise.
      prisma.campaign.findMany({
        where: { status: 'COMPLETED', ...campaignBrandWhere },
        select: {
          id: true,
          name: true,
          campaignInfluencers: {
            select: {
              deliverables: { select: { id: true, status: true, dueDate: true } },
              influencer: { select: { displayName: true } },
            },
          },
        },
      }),
      // Rule 6: a paid amount recorded against a roster row exceeds what was
      // actually agreed — a real financial discrepancy, not a display issue.
      prisma.campaignInfluencer.findMany({
        where: {
          paidAmount: { not: null },
          agreedCost: { not: null },
          campaign: campaignBrandWhere,
        },
        select: {
          id: true,
          paidAmount: true,
          agreedCost: true,
          currency: true,
          campaign: { select: { id: true, name: true, currency: true } },
          influencer: { select: { displayName: true } },
        },
      }),
      // Rule 7: a usage right's brand doesn't match the brand of the
      // campaign/content it's actually scoped to — usage rights are
      // brand-owned legal terms, so a cross-brand mismatch is a real error.
      prisma.usageRight.findMany({
        where: brandIds ? { brandId: { in: brandIds } } : {},
        select: {
          id: true,
          brandId: true,
          campaignId: true,
          publishedContentId: true,
          campaign: { select: { name: true, brandId: true } },
          publishedContent: { select: { originalUrl: true, brandId: true } },
        },
      }),
    ]);

    for (const c of contentRows) {
      const ci = c.deliverable?.campaignInfluencer;
      if (!ci) continue;
      if (c.campaignId && ci.campaignId !== c.campaignId) {
        out.push(
          mkFinding(
            'CONTENT_CAMPAIGN_DELIVERABLE_MISMATCH',
            c.id,
            'error',
            "Content's campaign doesn't match its deliverable's campaign",
            `"${c.originalUrl}" is tagged to campaign "${c.campaign?.name ?? c.campaignId}" but its linked deliverable belongs to campaign "${ci.campaign.name}".`,
            `/content/${c.id}`,
            now,
          ),
        );
      }
      if (c.influencerId && ci.influencerId !== c.influencerId) {
        out.push(
          mkFinding(
            'CONTENT_INFLUENCER_DELIVERABLE_MISMATCH',
            c.id,
            'error',
            "Content's creator doesn't match its deliverable's creator",
            `"${c.originalUrl}" is tagged to ${c.influencer?.displayName ?? c.influencerId} but its linked deliverable belongs to ${ci.influencer.displayName}.`,
            `/content/${c.id}`,
            now,
          ),
        );
      }
    }

    for (const d of productDeliverables) {
      if (d.shipments.some((s) => s.status === 'DELIVERED')) continue;
      const shipmentState = d.shipments.length === 0 ? 'no shipment was ever created' : 'no linked shipment reached Delivered';
      out.push(
        mkFinding(
          'DELIVERABLE_MISSING_LOGISTICS',
          d.id,
          'warning',
          'Product-required deliverable published without confirmed delivery',
          `${d.campaignInfluencer.influencer.displayName}'s ${d.platform} deliverable for "${d.campaignInfluencer.campaign.name}" requires a physical product and is marked ${d.status}, but ${shipmentState}.`,
          '/logistics',
          now,
        ),
      );
    }

    for (const d of deliverablesWithApproval) {
      const latest = d.submissions[0];
      if (!latest || latest.status !== 'APPROVED') continue;
      if (APPROVED_OR_LATER.has(d.status)) continue;
      out.push(
        mkFinding(
          'SUBMISSION_DELIVERABLE_MISMATCH',
          d.id,
          'warning',
          "Approved submission didn't advance its deliverable",
          `${d.campaignInfluencer.influencer.displayName}'s ${d.platform} deliverable for "${d.campaignInfluencer.campaign.name}" has an approved submission (v${latest.version}) but the deliverable itself is still ${d.status}.`,
          `/campaigns`,
          now,
        ),
      );
    }

    for (const camp of completedCampaigns) {
      const open = camp.campaignInfluencers.flatMap((ci) =>
        ci.deliverables.filter((d) => !TERMINAL_DELIVERABLE_STATUSES.has(d.status)).map((d) => ({ ...d, influencer: ci.influencer.displayName })),
      );
      if (open.length === 0) continue;
      const names = [...new Set(open.map((d) => d.influencer))].slice(0, 3).join(', ');
      out.push(
        mkFinding(
          'CAMPAIGN_COMPLETED_WITH_OVERDUE_DELIVERABLES',
          camp.id,
          'warning',
          'Completed campaign has deliverables still open',
          `"${camp.name}" is marked Completed but has ${open.length} deliverable${open.length === 1 ? '' : 's'} still in progress (e.g. ${names}).`,
          `/campaigns/${camp.id}`,
          now,
        ),
      );
    }

    for (const row of overpaid) {
      if (row.paidAmount == null || row.agreedCost == null) continue;
      if (row.paidAmount.lte(row.agreedCost)) continue;
      const currency = row.currency ?? row.campaign.currency;
      out.push(
        mkFinding(
          'PAID_AMOUNT_EXCEEDS_AGREED_COST',
          row.id,
          'error',
          'Paid amount exceeds the agreed cost',
          `${row.influencer.displayName}'s "${row.campaign.name}" deal was paid ${currency} ${row.paidAmount.toString()} against an agreed cost of ${currency} ${row.agreedCost.toString()}.`,
          `/campaigns/${row.campaign.id}`,
          now,
        ),
      );
    }

    for (const ur of usageRights) {
      if (ur.campaign && ur.campaign.brandId !== ur.brandId) {
        out.push(
          mkFinding(
            'USAGE_RIGHT_BRAND_MISMATCH',
            ur.id,
            'error',
            "Usage right's brand doesn't match its campaign's brand",
            `A usage right is scoped to a different brand than campaign "${ur.campaign.name}", which it's attached to.`,
            `/campaigns/${ur.campaignId}`,
            now,
          ),
        );
        continue;
      }
      if (ur.publishedContent && ur.publishedContent.brandId && ur.publishedContent.brandId !== ur.brandId) {
        out.push(
          mkFinding(
            'USAGE_RIGHT_BRAND_MISMATCH',
            ur.id,
            'error',
            "Usage right's brand doesn't match its content's brand",
            `A usage right is scoped to a different brand than the content it's attached to ("${ur.publishedContent.originalUrl}").`,
            `/content/${ur.publishedContentId}`,
            now,
          ),
        );
      }
    }

    return out;
  }

  return { findings };
}

export type IntegrityGuardService = ReturnType<typeof makeIntegrityGuardService>;
