import {
  type CaptionRulesDTO,
  requests,
  type DeliverableSubmissionDTO,
  type SubmissionCommentDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import { APPROVAL_COMPLETES_TYPES } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { captionRulesOf, captionRulesSelect } from '../lib/caption-rules';
import { requireActor, requireCapability } from '../lib/authz';
import { createNotification, iso, logActivity } from '../lib/helpers';
import {
  isBrandOutOfScope,
  isCountryOutOfScope,
  scopedBrandIds,
  scopedCountryCodes,
} from '../lib/scope';
import { attachmentSelect, toAttachmentDTO } from './attachment.service';

type SubmissionCreate = z.infer<typeof requests.submissionCreateSchema>;
type SubmissionReview = z.infer<typeof requests.submissionReviewSchema>;
type SubmissionCommentInput = z.infer<typeof requests.submissionCommentSchema>;

export const submissionInclude = {
  submittedBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  attachment: { select: attachmentSelect },
  comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } },
} satisfies Prisma.DeliverableSubmissionInclude;

type Row = Prisma.DeliverableSubmissionGetPayload<{ include: typeof submissionInclude }>;

// A reviewer's decision maps to the submission's new review status and the
// deliverable's resulting status. APPROVE completes a UGC deliverable (it is
// handed over, never posted); for any other type an approved draft is cleared
// to post, and it is delivered once the post is up (shared deliverable-rules).
const DECISION_MAP = {
  APPROVE: { submission: 'APPROVED', deliverable: 'APPROVED' },
  REQUEST_CHANGES: { submission: 'CHANGES_REQUESTED', deliverable: 'CHANGES_REQUESTED' },
  REJECT: { submission: 'REJECTED', deliverable: 'CHANGES_REQUESTED' },
} as const;

function toCommentDTO(c: Row['comments'][number]): SubmissionCommentDTO {
  return {
    id: c.id,
    authorName: c.author?.name ?? null,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function toSubmissionDTO(s: Row): Promise<DeliverableSubmissionDTO> {
  return {
    id: s.id,
    deliverableId: s.deliverableId,
    version: s.version,
    status: s.status,
    notes: s.notes,
    assetUrl: s.assetUrl,
    caption: s.caption,
    attachment: s.attachment ? await toAttachmentDTO(s.attachment) : null,
    submittedByName: s.submittedBy?.name ?? null,
    fromCreator: s.fromCreator,
    reviewedByName: s.reviewedBy?.name ?? null,
    reviewedAt: iso(s.reviewedAt),
    reviewNote: s.reviewNote,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    comments: s.comments.map(toCommentDTO),
  };
}

/**
 * Deliverable submission review/approval workflow (W3-1). A submission is a
 * creator's draft/asset against a deliverable; successive versions are the
 * revision rounds. Approving completes the deliverable without requiring a
 * public social URL, so genuine UGC becomes trackable and auditable.
 */
export function makeSubmissionService(ctx: DomainContext) {
  const { prisma } = ctx;

  // Direct-ID brand/country authorization (mirrors shipment.service.ts's
  // ciContext/loadDTO exactly): a scoped actor can never reach an
  // out-of-brand or out-of-country creator's submissions by guessing an id,
  // not merely have them hidden from a filtered list. Every function below
  // that takes a deliverableId, campaignId, or submissionId funnels through
  // one of these two checks.
  async function assertScopeForCampaignInfluencer(
    brandId: string,
    countryCode: string | null,
  ): Promise<void> {
    const brandScope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(brandScope, brandId)) throw AppError.notFound('Deliverable');
    const countryScope = await scopedCountryCodes(ctx);
    if (isCountryOutOfScope(countryScope, countryCode)) throw AppError.notFound('Deliverable');
  }

  async function deliverableContext(deliverableId: string) {
    const d = await prisma.deliverable.findUnique({
      where: { id: deliverableId },
      include: {
        campaignInfluencer: {
          select: {
            campaignId: true,
            influencerId: true,
            campaign: { select: { brandId: true } },
            influencer: { select: { countryCode: true } },
          },
        },
      },
    });
    if (!d) throw AppError.notFound('Deliverable');
    await assertScopeForCampaignInfluencer(
      d.campaignInfluencer.campaign.brandId,
      d.campaignInfluencer.influencer.countryCode,
    );
    return {
      deliverable: d,
      campaignId: d.campaignInfluencer.campaignId,
      influencerId: d.campaignInfluencer.influencerId,
    };
  }

  /** Same direct-ID scope check as deliverableContext, keyed by a submission
   *  instead of its deliverable — used by get/review/addComment, which are
   *  addressed by submissionId, not deliverableId. */
  async function assertSubmissionInScope(submissionId: string): Promise<{ deliverableId: string }> {
    const sub = await prisma.deliverableSubmission.findUnique({
      where: { id: submissionId },
      select: {
        deliverableId: true,
        deliverable: {
          select: {
            campaignInfluencer: {
              select: {
                campaign: { select: { brandId: true } },
                influencer: { select: { countryCode: true } },
              },
            },
          },
        },
      },
    });
    if (!sub) throw AppError.notFound('Submission');
    const brandScope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(brandScope, sub.deliverable.campaignInfluencer.campaign.brandId))
      throw AppError.notFound('Submission');
    const countryScope = await scopedCountryCodes(ctx);
    if (
      isCountryOutOfScope(countryScope, sub.deliverable.campaignInfluencer.influencer.countryCode)
    )
      throw AppError.notFound('Submission');
    return { deliverableId: sub.deliverableId };
  }

  async function get(submissionId: string): Promise<DeliverableSubmissionDTO> {
    await assertSubmissionInScope(submissionId);
    const row = await prisma.deliverableSubmission.findUnique({
      where: { id: submissionId },
      include: submissionInclude,
    });
    if (!row) throw AppError.notFound('Submission');
    return toSubmissionDTO(row);
  }

  async function listForDeliverable(deliverableId: string): Promise<DeliverableSubmissionDTO[]> {
    await deliverableContext(deliverableId);
    const rows = await prisma.deliverableSubmission.findMany({
      where: { deliverableId },
      orderBy: { version: 'asc' },
      include: submissionInclude,
    });
    return Promise.all(rows.map(toSubmissionDTO));
  }

  /** What this deliverable's caption must carry (P3.5), for checking a draft's or a post's caption. */
  async function captionRules(deliverableId: string): Promise<CaptionRulesDTO> {
    await deliverableContext(deliverableId);
    const d = await prisma.deliverable.findUniqueOrThrow({
      where: { id: deliverableId },
      select: captionRulesSelect,
    });
    return captionRulesOf(d);
  }

  /** Every submission across a campaign's deliverables — the review queue for
   *  the whole campaign in one query (W3-1 web surface), newest first. Brand
   *  scope only (not country): this spans every creator on the campaign, and
   *  a campaign belongs to exactly one brand. NOTE: campaign.service.ts
   *  itself does not currently check actor brand scope for a campaignId
   *  (its detail() only supports an optional explicit brandId narrowing
   *  param from the route, not the actor's own UserBrandAccess) — that is a
   *  separate, wider gap, out of scope for this fix; this check protects
   *  submissions specifically regardless of that. */
  async function listForCampaign(campaignId: string): Promise<DeliverableSubmissionDTO[]> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { brandId: true },
    });
    if (!campaign) throw AppError.notFound('Campaign');
    const brandScope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(brandScope, campaign.brandId)) throw AppError.notFound('Campaign');
    const rows = await prisma.deliverableSubmission.findMany({
      where: { deliverable: { campaignInfluencer: { campaignId } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: submissionInclude,
    });
    return Promise.all(rows.map(toSubmissionDTO));
  }

  async function create(
    deliverableId: string,
    input: SubmissionCreate,
  ): Promise<DeliverableSubmissionDTO> {
    const actor = requireActor(ctx);
    const { campaignId, influencerId } = await deliverableContext(deliverableId);
    if (input.attachmentId) {
      // Only a file uploaded to this very deliverable — never someone else's
      // file picked up by id.
      const file = await prisma.attachment.findUnique({
        where: { id: input.attachmentId },
        select: { deliverableId: true },
      });
      if (!file || file.deliverableId !== deliverableId)
        throw AppError.badRequest('That file was not uploaded to this deliverable.');
    }
    const last = await prisma.deliverableSubmission.findFirst({
      where: { deliverableId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;

    const created = await prisma.$transaction(async (tx) => {
      const sub = await tx.deliverableSubmission.create({
        data: {
          deliverableId,
          version,
          status: 'IN_REVIEW',
          notes: input.notes ?? null,
          assetUrl: input.assetUrl ?? null,
          caption: input.caption ?? null,
          attachmentId: input.attachmentId ?? null,
          submittedById: actor.id,
        },
        include: submissionInclude,
      });
      await tx.deliverable.update({ where: { id: deliverableId }, data: { status: 'IN_REVIEW' } });
      await logActivity(
        ctx,
        {
          type: 'DELIVERABLE_STATUS_CHANGED',
          message: `${actor.name} submitted draft v${version} for review.`,
          campaignId,
          influencerId,
          deliverableId,
          meta: { submissionId: sub.id, version },
        },
        tx,
      );
      await createNotification(
        ctx,
        {
          category: 'GENERAL',
          title: 'Draft submitted for review',
          body: `A deliverable draft (v${version}) is awaiting review.`,
          campaignId,
          influencerId,
        },
        tx,
      );
      return sub;
    });
    return toSubmissionDTO(created);
  }

  async function review(
    submissionId: string,
    input: SubmissionReview,
  ): Promise<DeliverableSubmissionDTO> {
    // HIGH severity (Security & Authorization Freeze Gate): this approves or
    // rejects a creator's UGC submission, completing the deliverable and
    // triggering payment-due state — was previously a bare requireActor, so
    // ANY authenticated user could review. Scope (brand/country) is already
    // enforced below via assertSubmissionInScope.
    const actor = await requireCapability(ctx, 'UGC_REVIEW');
    await assertSubmissionInScope(submissionId);
    const existing = await prisma.deliverableSubmission.findUnique({
      where: { id: submissionId },
      include: {
        deliverable: {
          include: { campaignInfluencer: { select: { campaignId: true, influencerId: true } } },
        },
      },
    });
    if (!existing) throw AppError.notFound('Submission');
    if (existing.status === 'APPROVED') {
      throw AppError.badRequest('This submission has already been approved.');
    }
    const target = DECISION_MAP[input.decision];
    const campaignId = existing.deliverable.campaignInfluencer.campaignId;
    const influencerId = existing.deliverable.campaignInfluencer.influencerId;

    const updated = await prisma.$transaction(async (tx) => {
      const sub = await tx.deliverableSubmission.update({
        where: { id: submissionId },
        data: {
          status: target.submission,
          reviewedById: actor.id,
          reviewedAt: new Date(),
          reviewNote: input.note ?? null,
        },
        include: submissionInclude,
      });
      await tx.deliverable.update({
        where: { id: existing.deliverableId },
        data: {
          status: target.deliverable,
          // For UGC, approval is the completion event — stamp publishedAt so
          // progress and freshness reflect it without a public post. Any other
          // type is only cleared to post; its post sets publishedAt later.
          ...(input.decision === 'APPROVE' &&
          (APPROVAL_COMPLETES_TYPES as readonly string[]).includes(existing.deliverable.type)
            ? { publishedAt: existing.deliverable.publishedAt ?? new Date() }
            : {}),
        },
      });
      await logActivity(
        ctx,
        {
          type: 'DELIVERABLE_STATUS_CHANGED',
          message: `${actor.name} ${
            input.decision === 'APPROVE'
              ? 'approved'
              : input.decision === 'REJECT'
                ? 'rejected'
                : 'requested changes on'
          } draft v${existing.version}.`,
          campaignId,
          influencerId,
          deliverableId: existing.deliverableId,
          meta: { submissionId, decision: input.decision },
        },
        tx,
      );
      await createNotification(
        ctx,
        {
          // APPROVED gets its own category so What's New can surface UGC
          // approvals as a distinct, real event (Content Command Center pass).
          category: input.decision === 'APPROVE' ? 'SUBMISSION_APPROVED' : 'GENERAL',
          title: `Draft ${target.submission.replace(/_/g, ' ').toLowerCase()}`,
          body: input.note ?? null,
          campaignId,
          influencerId,
        },
        tx,
      );
      return sub;
    });
    return toSubmissionDTO(updated);
  }

  async function addComment(
    submissionId: string,
    input: SubmissionCommentInput,
  ): Promise<DeliverableSubmissionDTO> {
    const actor = requireActor(ctx);
    await assertSubmissionInScope(submissionId);
    await prisma.submissionComment.create({
      data: { submissionId, authorId: actor.id, body: input.body },
    });
    return get(submissionId);
  }

  return { listForDeliverable, listForCampaign, get, create, review, addComment, captionRules };
}

export type SubmissionService = ReturnType<typeof makeSubmissionService>;
