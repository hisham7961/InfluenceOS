import {
  requests,
  type DeliverableSubmissionDTO,
  type SubmissionCommentDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { createNotification, iso, logActivity } from '../lib/helpers';

type SubmissionCreate = z.infer<typeof requests.submissionCreateSchema>;
type SubmissionReview = z.infer<typeof requests.submissionReviewSchema>;
type SubmissionCommentInput = z.infer<typeof requests.submissionCommentSchema>;

const submissionInclude = {
  submittedBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } },
} satisfies Prisma.DeliverableSubmissionInclude;

type Row = Prisma.DeliverableSubmissionGetPayload<{ include: typeof submissionInclude }>;

// A reviewer's decision maps to the submission's new review status and the
// deliverable's resulting status. APPROVE completes the deliverable — a UGC
// deliverable reaches this without ever having a public social URL (W3-1).
const DECISION_MAP = {
  APPROVE: { submission: 'APPROVED', deliverable: 'APPROVED' },
  REQUEST_CHANGES: { submission: 'CHANGES_REQUESTED', deliverable: 'CHANGES_REQUESTED' },
  REJECT: { submission: 'REJECTED', deliverable: 'CHANGES_REQUESTED' },
} as const;

function toCommentDTO(c: Row['comments'][number]): SubmissionCommentDTO {
  return { id: c.id, authorName: c.author?.name ?? null, body: c.body, createdAt: c.createdAt.toISOString() };
}

function toDTO(s: Row): DeliverableSubmissionDTO {
  return {
    id: s.id,
    deliverableId: s.deliverableId,
    version: s.version,
    status: s.status,
    notes: s.notes,
    assetUrl: s.assetUrl,
    submittedByName: s.submittedBy?.name ?? null,
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

  async function deliverableContext(deliverableId: string) {
    const d = await prisma.deliverable.findUnique({
      where: { id: deliverableId },
      include: { campaignInfluencer: { select: { campaignId: true, influencerId: true } } },
    });
    if (!d) throw AppError.notFound('Deliverable');
    return { deliverable: d, campaignId: d.campaignInfluencer.campaignId, influencerId: d.campaignInfluencer.influencerId };
  }

  async function get(submissionId: string): Promise<DeliverableSubmissionDTO> {
    const row = await prisma.deliverableSubmission.findUnique({ where: { id: submissionId }, include: submissionInclude });
    if (!row) throw AppError.notFound('Submission');
    return toDTO(row);
  }

  async function listForDeliverable(deliverableId: string): Promise<DeliverableSubmissionDTO[]> {
    const rows = await prisma.deliverableSubmission.findMany({
      where: { deliverableId },
      orderBy: { version: 'asc' },
      include: submissionInclude,
    });
    return rows.map(toDTO);
  }

  /** Every submission across a campaign's deliverables — the review queue for
   *  the whole campaign in one query (W3-1 web surface), newest first. */
  async function listForCampaign(campaignId: string): Promise<DeliverableSubmissionDTO[]> {
    const rows = await prisma.deliverableSubmission.findMany({
      where: { deliverable: { campaignInfluencer: { campaignId } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: submissionInclude,
    });
    return rows.map(toDTO);
  }

  async function create(deliverableId: string, input: SubmissionCreate): Promise<DeliverableSubmissionDTO> {
    const actor = requireActor(ctx);
    const { campaignId, influencerId } = await deliverableContext(deliverableId);
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
    return toDTO(created);
  }

  async function review(submissionId: string, input: SubmissionReview): Promise<DeliverableSubmissionDTO> {
    const actor = requireActor(ctx);
    const existing = await prisma.deliverableSubmission.findUnique({
      where: { id: submissionId },
      include: {
        deliverable: { include: { campaignInfluencer: { select: { campaignId: true, influencerId: true } } } },
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
          // Approval is the completion event — stamp publishedAt so progress and
          // freshness reflect it, without needing a public post (UGC).
          ...(input.decision === 'APPROVE'
            ? { publishedAt: existing.deliverable.publishedAt ?? new Date() }
            : {}),
        },
      });
      await logActivity(
        ctx,
        {
          type: 'DELIVERABLE_STATUS_CHANGED',
          message: `${actor.name} ${
            input.decision === 'APPROVE' ? 'approved' : input.decision === 'REJECT' ? 'rejected' : 'requested changes on'
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
          category: 'GENERAL',
          title: `Draft ${target.submission.replace(/_/g, ' ').toLowerCase()}`,
          body: input.note ?? null,
          campaignId,
          influencerId,
        },
        tx,
      );
      return sub;
    });
    return toDTO(updated);
  }

  async function addComment(submissionId: string, input: SubmissionCommentInput): Promise<DeliverableSubmissionDTO> {
    const actor = requireActor(ctx);
    const sub = await prisma.deliverableSubmission.findUnique({ where: { id: submissionId }, select: { id: true } });
    if (!sub) throw AppError.notFound('Submission');
    await prisma.submissionComment.create({ data: { submissionId, authorId: actor.id, body: input.body } });
    return get(submissionId);
  }

  return { listForDeliverable, listForCampaign, get, create, review, addComment };
}

export type SubmissionService = ReturnType<typeof makeSubmissionService>;
