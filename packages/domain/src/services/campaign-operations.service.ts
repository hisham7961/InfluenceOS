import {
  type CampaignOperationsBoardDTO,
  type CampaignOperationsRowDTO,
  type CampaignOperationsStageDTO,
  type CampaignOperationsStageState,
} from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { requireActor } from '../lib/authz';
import { makeCampaignService } from './campaign.service';

type FilterBucket = CampaignOperationsRowDTO['filterBuckets'][number];

const PUBLISHED_STATUSES = new Set(['PUBLISHED', 'VERIFIED']);
// AWAITING_PUBLICATION is grouped with PLANNED/SENT_TO_INFLUENCER elsewhere as
// an "open" deliverable (analytics.service.ts's OPEN_DELIVERABLE) because some
// deliverables skip formal review entirely — the creator is trusted to publish
// directly once briefed. That means "review"/"approved" only apply to
// deliverables that actually went through DeliverableSubmission at least once
// (`hasSubmission`); a direct-publish deliverable reports 'na' for those two
// columns instead of a false "pending".
const DRAFT_NOT_REACHED = new Set(['PLANNED', 'SENT_TO_INFLUENCER']);
const CLEARED_TO_PUBLISH = new Set(['APPROVED', 'AWAITING_PUBLICATION', 'PUBLISHED', 'VERIFIED']);

interface DeliverableRow {
  status: string;
  dueDate: Date | null;
  requiresProduct: boolean;
  hasSubmission: boolean;
}

function mk(
  key: CampaignOperationsStageDTO['key'],
  label: string,
  state: CampaignOperationsStageState,
  detail: string | null,
  link: string | null,
): CampaignOperationsStageDTO {
  return { key, label, state, detail, link };
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * Every stage below is derived from real records at read time (no stored
 * per-stage status ever exists to drift from the truth). All 8 functions take
 * the same `now` so a single request produces internally-consistent overdue
 * judgements.
 */
function deriveStages(
  ci: {
    id: string;
    campaignId: string;
    participationStatus: string;
    paymentStatus: string;
    dateContacted: Date | null;
    expectedPublishAt: Date | null;
  },
  deliverables: DeliverableRow[],
  shipmentStatuses: string[],
  hasOpenLogisticsIssue: boolean,
  now: Date,
): CampaignOperationsStageDTO[] {
  const tabLink = (tab: string) => `/campaigns/${ci.campaignId}?tab=${tab}`;

  // 1. Agreement — whether the creator has confirmed participation.
  const agreement =
    ci.participationStatus === 'DECLINED'
      ? mk('agreement', 'Agreement', 'na', 'Declined', tabLink('influencers'))
      : ci.participationStatus === 'DROPPED'
        ? mk('agreement', 'Agreement', 'na', 'Dropped', tabLink('influencers'))
        : ci.participationStatus === 'INVITED'
          ? mk('agreement', 'Agreement', 'pending', ci.dateContacted ? 'Invited, awaiting confirmation' : 'Not yet contacted', tabLink('influencers'))
          : mk('agreement', 'Agreement', 'done', 'Confirmed', tabLink('influencers'));

  // 2. Product — only applicable when at least one deliverable is flagged as
  // requiring a physical product, or a shipment already exists for this row.
  const needsProduct = deliverables.some((d) => d.requiresProduct) || shipmentStatuses.length > 0;
  // An open Address Clarification issue is the real blocker regardless of
  // the shipment's own status (which may still read PENDING) — reuses the
  // SAME LogisticsIssue record the Logistics workspace shows, never a
  // second campaign-logistics state (Advanced Roles & Logistics pass).
  const product = !needsProduct
    ? mk('product', 'Product', 'na', 'No product required', null)
    : hasOpenLogisticsIssue
      ? mk('product', 'Product', 'overdue', 'Address Clarification needed', tabLink('shipments'))
      : shipmentStatuses.includes('DELIVERED')
      ? mk('product', 'Product', 'done', 'Delivered', tabLink('shipments'))
      : shipmentStatuses.some((s) => s === 'SHIPPED' || s === 'IN_TRANSIT')
        ? mk('product', 'Product', 'waiting', 'In transit', tabLink('shipments'))
        : shipmentStatuses.some((s) => s === 'FAILED' || s === 'RETURNED')
          ? mk('product', 'Product', 'overdue', 'Shipment failed or was returned', tabLink('shipments'))
          : shipmentStatuses.includes('PENDING')
            ? mk('product', 'Product', 'pending', 'Shipment pending', tabLink('shipments'))
            : mk('product', 'Product', 'pending', 'Not yet shipped', tabLink('shipments'));

  // Live (non-cancelled) deliverables only — a cancelled deliverable was
  // already excluded from the query.
  const live = deliverables;
  const missed = live.filter((d) => d.status === 'MISSED');
  const countable = live.filter((d) => d.status !== 'MISSED');

  // 3. Content due — are outstanding deliverables tracking to their due dates?
  const unpublished = countable.filter((d) => !PUBLISHED_STATUSES.has(d.status));
  let contentDue: CampaignOperationsStageDTO;
  if (live.length === 0) {
    contentDue = mk('contentDue', 'Content Due', 'na', 'No deliverables yet', tabLink('deliverables'));
  } else if (missed.length > 0) {
    contentDue = mk('contentDue', 'Content Due', 'overdue', `${missed.length} deliverable${missed.length === 1 ? '' : 's'} missed`, tabLink('deliverables'));
  } else if (unpublished.length === 0) {
    contentDue = mk('contentDue', 'Content Due', 'done', 'All due dates met', tabLink('deliverables'));
  } else {
    const overdueOnes = unpublished.filter((d) => d.dueDate && d.dueDate.getTime() < now.getTime());
    const withDueDate = unpublished.filter((d) => d.dueDate);
    contentDue =
      overdueOnes.length > 0
        ? mk('contentDue', 'Content Due', 'overdue', `${overdueOnes.length} past due`, tabLink('deliverables'))
        : withDueDate.length > 0
          ? mk(
              'contentDue',
              'Content Due',
              'pending',
              (() => {
                const soonest = withDueDate.reduce((a, b) => (a.dueDate! < b.dueDate! ? a : b));
                const days = daysBetween(soonest.dueDate!, now);
                return days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`;
              })(),
              tabLink('deliverables'),
            )
          : mk('contentDue', 'Content Due', 'waiting', 'No due date set', tabLink('deliverables'));
  }
  const contentDueOverdue = contentDue.state === 'overdue';

  // 4. Draft — has the creator produced a first draft / asset?
  const draftNotReached = countable.filter((d) => DRAFT_NOT_REACHED.has(d.status));
  let draft: CampaignOperationsStageDTO;
  if (live.length === 0) {
    draft = mk('draft', 'Draft', 'na', null, tabLink('deliverables'));
  } else if (draftNotReached.length === 0) {
    draft = mk('draft', 'Draft', 'done', 'Draft received', tabLink('submissions'));
  } else if (contentDueOverdue) {
    draft = mk('draft', 'Draft', 'overdue', `${draftNotReached.length} deliverable${draftNotReached.length === 1 ? '' : 's'} still missing a draft`, tabLink('submissions'));
  } else if (draftNotReached.some((d) => d.status === 'SENT_TO_INFLUENCER')) {
    draft = mk('draft', 'Draft', 'pending', 'Awaiting draft from creator', tabLink('submissions'));
  } else {
    draft = mk('draft', 'Draft', 'waiting', 'Not yet briefed to creator', tabLink('deliverables'));
  }

  // 5. Review — only meaningful for deliverables that actually went through a
  // DeliverableSubmission (direct-publish deliverables report 'na').
  const reviewable = countable.filter((d) => d.hasSubmission);
  const stillInReview = reviewable.filter((d) => d.status === 'IN_REVIEW');
  const review =
    reviewable.length === 0
      ? mk('review', 'Review', 'na', null, tabLink('submissions'))
      : stillInReview.length > 0
        ? mk('review', 'Review', 'pending', `${stillInReview.length} awaiting your review`, tabLink('submissions'))
        : mk('review', 'Review', 'done', 'Reviewed', tabLink('submissions'));

  // 6. Approved — cleared to publish, whether via formal approval or a
  // direct-publish deliverable that never needed one.
  const notCleared = countable.filter((d) => !CLEARED_TO_PUBLISH.has(d.status));
  const changesRequested = notCleared.filter((d) => d.status === 'CHANGES_REQUESTED');
  let approved: CampaignOperationsStageDTO;
  if (live.length === 0) {
    approved = mk('approved', 'Approved', 'na', null, tabLink('submissions'));
  } else if (notCleared.length === 0) {
    approved = mk('approved', 'Approved', 'done', 'Cleared to publish', tabLink('submissions'));
  } else if (changesRequested.length > 0) {
    approved = mk('approved', 'Approved', 'waiting', 'Awaiting a revised draft from the creator', tabLink('submissions'));
  } else {
    approved = mk('approved', 'Approved', 'pending', null, tabLink('submissions'));
  }

  // 7. Published.
  let published: CampaignOperationsStageDTO;
  if (live.length === 0) {
    published = mk('published', 'Published', 'na', null, tabLink('content'));
  } else if (missed.length > 0) {
    published = mk('published', 'Published', 'overdue', `${missed.length} deliverable${missed.length === 1 ? '' : 's'} missed`, tabLink('content'));
  } else if (countable.length > 0 && countable.every((d) => PUBLISHED_STATUSES.has(d.status))) {
    published = mk('published', 'Published', 'done', 'Published', tabLink('content'));
  } else if (ci.expectedPublishAt && ci.expectedPublishAt.getTime() < now.getTime()) {
    published = mk('published', 'Published', 'overdue', 'Past the expected publish date', tabLink('content'));
  } else if (approved.state === 'done') {
    published = mk('published', 'Published', 'pending', 'Approved, awaiting publish', tabLink('content'));
  } else {
    published = mk('published', 'Published', 'na', null, tabLink('content'));
  }

  // 8. Payment — NOT_APPLICABLE deals (FREE/GIFTED) never show as owing.
  let payment: CampaignOperationsStageDTO;
  if (ci.paymentStatus === 'NOT_APPLICABLE') {
    payment = mk('payment', 'Payment', 'na', 'No payment due (free/gifted)', tabLink('costs'));
  } else if (ci.paymentStatus === 'PAID') {
    payment = mk('payment', 'Payment', 'done', 'Paid', tabLink('costs'));
  } else if (ci.paymentStatus === 'PARTIALLY_PAID') {
    payment = mk('payment', 'Payment', 'pending', 'Partially paid — balance due', tabLink('costs'));
  } else if (published.state === 'done') {
    payment = mk('payment', 'Payment', 'pending', 'Payment due', tabLink('costs'));
  } else {
    payment = mk('payment', 'Payment', 'na', 'Not yet due', tabLink('costs'));
  }

  return [agreement, product, contentDue, draft, review, approved, published, payment];
}

function deriveFilterBuckets(stages: CampaignOperationsStageDTO[], participationStatus: string): FilterBucket[] {
  if (participationStatus === 'DECLINED' || participationStatus === 'DROPPED') return [];

  const byKey = Object.fromEntries(stages.map((s) => [s.key, s])) as Record<CampaignOperationsStageDTO['key'], CampaignOperationsStageDTO>;
  const buckets = new Set<FilterBucket>();

  const anyOverdue = stages.some((s) => s.state === 'overdue');
  if (anyOverdue) {
    buckets.add('overdue');
    buckets.add('needsAttention');
  }
  if (byKey.product.state === 'pending' || byKey.product.state === 'waiting') buckets.add('waitingForProduct');
  if (byKey.draft.state === 'pending' || byKey.approved.state === 'waiting') buckets.add('waitingForCreator');
  if (byKey.review.state === 'pending') buckets.add('inReview');
  if (byKey.approved.state === 'done' && byKey.published.state !== 'done') buckets.add('readyToPublish');
  if (byKey.published.state === 'done') buckets.add('published');
  if (byKey.payment.state === 'pending' || byKey.payment.state === 'overdue') buckets.add('paymentPending');

  const contentSettled = byKey.published.state === 'done' || byKey.published.state === 'na';
  const paymentSettled = byKey.payment.state === 'done' || byKey.payment.state === 'na';
  if (participationStatus === 'COMPLETED' || (contentSettled && paymentSettled && !anyOverdue)) {
    buckets.add('completed');
  } else if (!anyOverdue && !buckets.has('waitingForProduct') && !buckets.has('waitingForCreator') && !buckets.has('inReview')) {
    buckets.add('onTrack');
  }

  return Array.from(buckets);
}

/**
 * Campaign Operations Board (Operations Intelligence pass, PART 33-36) — one
 * row per CampaignInfluencer, 8 stages derived at read time from
 * CampaignInfluencer/Deliverable/DeliverableSubmission/ProductShipment
 * fields. No per-stage status is ever written to the database, so the board
 * can never drift from the underlying records.
 */
export function makeCampaignOperationsService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function board(campaignId: string): Promise<CampaignOperationsBoardDTO> {
    requireActor(ctx);
    // Security & Authorization Freeze Gate, section 10 — reuse the shared,
    // brand-scope-checked campaign lookup instead of duplicating a raw
    // findUnique + scope check here (this was already correct, just
    // duplicated; now it can't independently drift from campaign.service.ts).
    await makeCampaignService(ctx).assertInScope(campaignId);

    const rows = await prisma.campaignInfluencer.findMany({
      where: { campaignId },
      select: {
        id: true,
        campaignId: true,
        influencerId: true,
        participationStatus: true,
        paymentStatus: true,
        dateContacted: true,
        expectedPublishAt: true,
        influencer: {
          select: {
            displayName: true,
            avatarOverrideUrl: true,
            resolvedAvatarUrl: true,
            socialAccounts: { where: { isPrimary: true }, select: { avatarUrl: true }, take: 1 },
          },
        },
        deliverables: {
          where: { status: { not: 'CANCELLED' } },
          select: {
            status: true,
            dueDate: true,
            requiresProduct: true,
            submissions: { select: { id: true }, take: 1 },
          },
          orderBy: { createdAt: 'asc' },
        },
        shipments: { select: { status: true, issues: { where: { status: 'OPEN' }, select: { id: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const now = new Date();
    const board: CampaignOperationsRowDTO[] = rows.map((ci) => {
      const deliverables: DeliverableRow[] = ci.deliverables.map((d) => ({
        status: d.status,
        dueDate: d.dueDate,
        requiresProduct: d.requiresProduct,
        hasSubmission: d.submissions.length > 0,
      }));
      const hasOpenLogisticsIssue = ci.shipments.some((s) => s.issues.length > 0);
      const stages = deriveStages(ci, deliverables, ci.shipments.map((s) => s.status), hasOpenLogisticsIssue, now);
      const avatarUrl = ci.influencer.avatarOverrideUrl ?? ci.influencer.resolvedAvatarUrl ?? ci.influencer.socialAccounts[0]?.avatarUrl ?? null;
      return {
        campaignInfluencerId: ci.id,
        influencerId: ci.influencerId,
        influencerName: ci.influencer.displayName,
        influencerAvatarUrl: avatarUrl,
        participationStatus: ci.participationStatus as CampaignOperationsRowDTO['participationStatus'],
        stages,
        filterBuckets: deriveFilterBuckets(stages, ci.participationStatus),
      };
    });

    return { campaignId, rows: board };
  }

  return { board };
}

export type CampaignOperationsService = ReturnType<typeof makeCampaignOperationsService>;
