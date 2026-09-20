'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardCheck, ExternalLink } from 'lucide-react';
import type { CampaignInfluencerDTO, DeliverableSubmissionDTO } from '@influenceos/contracts';
import {
  DELIVERABLE_TYPE_LABELS,
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUS_TONE,
  type SubmissionDecision,
} from '@influenceos/shared';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { relativeTime } from '@/lib/format';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong.';
}

const OPEN_STATUSES = new Set(['IN_REVIEW', 'CHANGES_REQUESTED']);

/** Submission review queue for a campaign (W3-1 web surface): every draft
 *  submitted across the campaign's deliverables with its version, review status
 *  and reviewer — so "what's waiting on me?" is answerable. Open submissions can
 *  be reviewed (approve/request changes/reject) directly from this queue. */
export function SubmissionsTab({ campaignId, influencers }: { campaignId: string; influencers: CampaignInfluencerDTO[] }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-submissions', campaignId],
    queryFn: () => api.campaigns.submissions(campaignId),
  });
  const [reviewing, setReviewing] = React.useState<DeliverableSubmissionDTO | null>(null);

  // deliverableId → { creator, platform, type } from the roster we already have.
  const byDeliverable = new Map(
    influencers.flatMap((ci) => ci.deliverables.map((d) => [d.id, { creator: ci.influencer.displayName, platform: d.platform, type: d.type }] as const)),
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <EmptyState icon={ClipboardCheck} title="Couldn't load submissions" description="Something went wrong fetching the review queue. Try again shortly." />;
  }

  const submissions = data ?? [];
  const pending = submissions.filter((s) => s.status === 'IN_REVIEW').length;

  if (submissions.length === 0) {
    return <EmptyState icon={ClipboardCheck} title="No submissions yet" description="Drafts submitted for review across this campaign's deliverables will appear here." />;
  }

  return (
    <div className="space-y-3">
      {pending > 0 ? (
        <p className="text-sm text-muted-foreground">
          <Badge tone="warning" className="me-1">{pending}</Badge> awaiting review
        </p>
      ) : null}
      <Card className="overflow-hidden">
        <TableScroll>
          <Table className="min-w-[820px]">
            <TableHead>
              <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                <TableHeaderCell className="ps-5">Creator</TableHeaderCell>
                <TableHeaderCell>Deliverable</TableHeaderCell>
                <TableHeaderCell align="end">Ver.</TableHeaderCell>
                <TableHeaderCell>Submitted</TableHeaderCell>
                <TableHeaderCell>Reviewer</TableHeaderCell>
                <TableHeaderCell align="end">Status</TableHeaderCell>
                <TableHeaderCell align="end" className="pe-5">
                  Action
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {submissions.map((s) => {
                const d = byDeliverable.get(s.deliverableId);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="ps-5 font-medium">{d?.creator ?? '—'}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        {d ? <PlatformBadge platform={d.platform} size="sm" /> : null}
                        <span className="text-muted-foreground">{d ? DELIVERABLE_TYPE_LABELS[d.type] : '—'}</span>
                      </span>
                    </TableCell>
                    <TableCell align="end" className="tabular-nums">v{s.version}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.submittedByName ?? '—'} · {relativeTime(s.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.reviewedByName ?? '—'}</TableCell>
                    <TableCell align="end">
                      <Badge tone={SUBMISSION_STATUS_TONE[s.status]}>{SUBMISSION_STATUS_LABELS[s.status]}</Badge>
                    </TableCell>
                    <TableCell align="end" className="pe-5">
                      {OPEN_STATUSES.has(s.status) ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => setReviewing(s)}>
                          Review
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
      </Card>

      <SubmissionReviewDialog
        submission={reviewing}
        creatorName={reviewing ? byDeliverable.get(reviewing.deliverableId)?.creator : undefined}
        open={reviewing != null}
        onOpenChange={(v) => {
          if (!v) setReviewing(null);
        }}
      />
    </div>
  );
}

/**
 * The submission review surface: approve/request changes/reject, plus a
 * threaded comment box. Approving completes the deliverable directly —
 * never creates or requires a PublishedContent URL (owned UGC).
 */
function SubmissionReviewDialog({
  submission,
  creatorName,
  open,
  onOpenChange,
}: {
  submission: DeliverableSubmissionDTO | null;
  creatorName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [note, setNote] = React.useState('');
  const [comment, setComment] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setNote('');
      setComment('');
    }
  }, [open]);

  const decide = useMutation({
    mutationFn: (decision: SubmissionDecision) => {
      if (!submission) throw new Error('No submission selected.');
      return api.submissions.review(submission.id, { decision, note: note.trim() || undefined });
    },
    onSuccess: (_, decision) => {
      toast.success(
        decision === 'APPROVE' ? 'Approved — deliverable completed, no public post required.' : 'Feedback sent.',
      );
      queryClient.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const addComment = useMutation({
    mutationFn: () => {
      if (!submission) throw new Error('No submission selected.');
      return api.submissions.addComment(submission.id, { body: comment.trim() });
    },
    onSuccess: () => {
      setComment('');
      queryClient.invalidateQueries();
      router.refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!submission) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review submission</DialogTitle>
          <DialogDescription>
            {creatorName ? `${creatorName} · ` : ''}Version {submission.version}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {submission.assetUrl ? (
            <a
              href={submission.assetUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
            >
              Open asset <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">No asset link — the file was shared outside the system.</p>
          )}
          {submission.notes ? <p className="text-sm text-foreground">{submission.notes}</p> : null}

          {submission.comments.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-border bg-surface-muted p-3">
              {submission.comments.map((c) => (
                <div key={c.id} className="text-xs">
                  <span className="font-medium text-foreground">{c.authorName ?? 'Someone'}</span>{' '}
                  <span className="text-muted-foreground">{relativeTime(c.createdAt)}</span>
                  <p className="mt-0.5 text-foreground">{c.body}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment…"
              rows={2}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!comment.trim() || addComment.isPending}
              onClick={() => addComment.mutate()}
            >
              {addComment.isPending ? '…' : 'Post'}
            </Button>
          </div>

          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Decision note (optional)…"
            rows={2}
          />
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" disabled={decide.isPending} onClick={() => decide.mutate('REJECT')}>
              Reject
            </Button>
            <Button type="button" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate('REQUEST_CHANGES')}>
              Request changes
            </Button>
            <Button type="button" disabled={decide.isPending} onClick={() => decide.mutate('APPROVE')}>
              Approve
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
