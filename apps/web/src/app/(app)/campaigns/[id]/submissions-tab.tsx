'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardCheck, Copy, Download, ExternalLink, Paperclip } from 'lucide-react';
import type { CampaignInfluencerDTO, DeliverableSubmissionDTO } from '@influenceos/contracts';
import { SUBMISSION_STATUS_TONE, type SubmissionDecision } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { toBrowserUrl } from '@/lib/upload';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText } from '@/components/common/bidi-text';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableScroll,
} from '@/components/ui/table';
import { useLocalizedFormat } from '@/lib/format';
import { WhatsAppDialog } from '@/components/influencers/whatsapp-dialog';
import { DeliverableCaptionCheck } from '@/components/content/caption-check';
import { errorMessage } from '@/lib/errors';

const OPEN_STATUSES = new Set(['IN_REVIEW', 'CHANGES_REQUESTED']);

/** Submission review queue for a campaign (W3-1 web surface): every draft
 *  submitted across the campaign's deliverables with its version, review status
 *  and reviewer — so "what's waiting on me?" is answerable. Open submissions can
 *  be reviewed (approve/request changes/reject) directly from this queue. */
export function SubmissionsTab({
  campaignId,
  campaignName,
  brandName,
  influencers,
}: {
  campaignId: string;
  campaignName?: string;
  brandName?: string;
  influencers: CampaignInfluencerDTO[];
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const { relativeTime } = useLocalizedFormat();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-submissions', campaignId],
    queryFn: () => api.campaigns.submissions(campaignId),
  });
  const [reviewing, setReviewing] = React.useState<DeliverableSubmissionDTO | null>(null);

  // deliverableId → { creator, platform, type } from the roster we already have.
  const byDeliverable = new Map(
    influencers.flatMap((ci) =>
      ci.deliverables.map(
        (d) =>
          [
            d.id,
            {
              creator: ci.influencer.displayName,
              influencerId: ci.influencer.id,
              ciId: ci.id,
              platform: d.platform,
              type: d.type,
            },
          ] as const,
      ),
    ),
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
    return (
      <EmptyState
        icon={ClipboardCheck}
        title={t('submissions.loadErrorTitle')}
        description={t('submissions.loadErrorDescription')}
      />
    );
  }

  const submissions = data ?? [];
  const pending = submissions.filter((s) => s.status === 'IN_REVIEW').length;

  if (submissions.length === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title={t('submissions.emptyTitle')}
        description={t('submissions.emptyDescription')}
      />
    );
  }

  return (
    <div className="space-y-3">
      {pending > 0 ? (
        <p className="text-muted-foreground text-sm">
          <Badge tone="warning" className="me-1">
            {pending}
          </Badge>{' '}
          {t('submissions.awaitingReview')}
        </p>
      ) : null}
      <Card className="overflow-hidden">
        <TableScroll>
          <Table className="min-w-[820px]">
            <TableHead>
              <TableRow className="border-border bg-surface-muted/60 hover:bg-surface-muted/60 border-b">
                <TableHeaderCell className="ps-5">{t('sourcing.creatorHeader')}</TableHeaderCell>
                <TableHeaderCell>{t('submissions.deliverableHeader')}</TableHeaderCell>
                <TableHeaderCell align="end">{t('submissions.verHeader')}</TableHeaderCell>
                <TableHeaderCell>{t('submissions.submittedHeader')}</TableHeaderCell>
                <TableHeaderCell>{t('submissions.reviewerHeader')}</TableHeaderCell>
                <TableHeaderCell align="end">{t('fields.status')}</TableHeaderCell>
                <TableHeaderCell align="end" className="pe-5">
                  {tCommon('actions')}
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {submissions.map((s) => {
                const d = byDeliverable.get(s.deliverableId);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="ps-5 font-medium">
                      {d?.creator ? <BidiText>{d.creator}</BidiText> : '—'}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        {d ? <PlatformBadge platform={d.platform} size="sm" /> : null}
                        <span className="text-muted-foreground">
                          {d ? enumLabel(tEnums, 'deliverableType', d.type) : '—'}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell align="end" className="tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        {s.attachment ? (
                          <Paperclip
                            className="text-muted-foreground h-3.5 w-3.5"
                            aria-label={t('submissions.hasFile')}
                          />
                        ) : null}
                        v{s.version}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.fromCreator ? (
                        t('submissions.fromCreator')
                      ) : s.submittedByName ? (
                        <BidiText>{s.submittedByName}</BidiText>
                      ) : (
                        '—'
                      )}{' '}
                      · {relativeTime(s.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.reviewedByName ? <BidiText>{s.reviewedByName}</BidiText> : '—'}
                    </TableCell>
                    <TableCell align="end">
                      <Badge tone={SUBMISSION_STATUS_TONE[s.status]}>
                        {enumLabel(tEnums, 'submissionStatus', s.status)}
                      </Badge>
                    </TableCell>
                    <TableCell align="end" className="pe-5">
                      {OPEN_STATUSES.has(s.status) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setReviewing(s)}
                        >
                          {t('submissions.reviewButton')}
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
        deliverableType={reviewing ? byDeliverable.get(reviewing.deliverableId)?.type : undefined}
        whatsapp={(() => {
          const d = reviewing ? byDeliverable.get(reviewing.deliverableId) : undefined;
          return d
            ? {
                influencerId: d.influencerId,
                campaignInfluencerId: d.ciId,
                campaignName,
                brandName,
                deliverables: [{ type: d.type, platform: d.platform }],
              }
            : undefined;
        })()}
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
  deliverableType,
  whatsapp,
  open,
  onOpenChange,
}: {
  submission: DeliverableSubmissionDTO | null;
  creatorName?: string;
  deliverableType?: string;
  /** Who to message about changes, and what about. */
  whatsapp?: {
    influencerId: string;
    campaignInfluencerId: string;
    campaignName?: string;
    brandName?: string;
    deliverables: { type: string; platform: string }[];
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const { relativeTime } = useLocalizedFormat();
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
      if (!submission) throw new Error(t('submissions.noSubmissionSelected'));
      return api.submissions.review(submission.id, { decision, note: note.trim() || undefined });
    },
    onSuccess: (_, decision) => {
      toast.success(
        decision !== 'APPROVE'
          ? t('submissions.feedbackSentToast')
          : deliverableType === 'UGC'
            ? t('submissions.approvedToast')
            : t('submissions.approvedToPostToast'),
      );
      queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const addComment = useMutation({
    mutationFn: () => {
      if (!submission) throw new Error(t('submissions.noSubmissionSelected'));
      return api.submissions.addComment(submission.id, { body: comment.trim() });
    },
    onSuccess: () => {
      setComment('');
      queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  if (!submission) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('submissions.reviewDialogTitle')}</DialogTitle>
          <DialogDescription>
            {creatorName
              ? t('submissions.reviewDialogDescriptionNamed', {
                  name: creatorName,
                  version: submission.version,
                })
              : t('submissions.reviewDialogDescriptionGeneric', { version: submission.version })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {submission.attachment ? <DraftPreview file={submission.attachment} /> : null}
          {submission.caption ? (
            <div className="border-border bg-surface-muted rounded-lg border p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                  {t('submissions.captionLabel')}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('submissions.copyCaption')}
                  title={t('submissions.copyCaption')}
                  onClick={() => {
                    navigator.clipboard
                      .writeText(submission.caption ?? '')
                      .then(() => toast.success(t('submissions.captionCopied')))
                      .catch(() => undefined);
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="whitespace-pre-wrap text-sm" dir="auto">
                {submission.caption}
              </p>
            </div>
          ) : null}
          {submission.caption ? (
            <DeliverableCaptionCheck
              deliverableId={submission.deliverableId}
              caption={submission.caption}
            />
          ) : null}
          {submission.assetUrl ? (
            <a
              href={submission.assetUrl}
              target="_blank"
              rel="noreferrer"
              className="text-brand flex items-center gap-1.5 text-sm font-medium hover:underline"
            >
              {t('submissions.openAsset')} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : submission.attachment ? null : (
            <p className="text-muted-foreground text-sm">{t('submissions.noAssetLink')}</p>
          )}
          {submission.notes ? <p className="text-foreground text-sm">{submission.notes}</p> : null}

          {submission.comments.length > 0 ? (
            <div className="border-border bg-surface-muted space-y-2 rounded-lg border p-3">
              {submission.comments.map((c) => (
                <div key={c.id} className="text-xs">
                  <span className="text-foreground font-medium">
                    {c.authorName ? (
                      <BidiText>{c.authorName}</BidiText>
                    ) : (
                      t('submissions.someoneFallback')
                    )}
                  </span>{' '}
                  <span className="text-muted-foreground">{relativeTime(c.createdAt)}</span>
                  <p className="text-foreground mt-0.5">{c.body}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('submissions.addCommentPlaceholder')}
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
              {addComment.isPending ? '…' : t('submissions.postButton')}
            </Button>
          </div>

          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('submissions.decisionNotePlaceholder')}
            rows={2}
          />
          {whatsapp && creatorName ? (
            <WhatsAppDialog
              variant="outline"
              influencerId={whatsapp.influencerId}
              creatorName={creatorName}
              purpose="CHANGES"
              campaignInfluencerId={whatsapp.campaignInfluencerId}
              context={{
                campaignName: whatsapp.campaignName,
                brandName: whatsapp.brandName,
                deliverables: whatsapp.deliverables,
                feedback: note.trim() || null,
              }}
            />
          ) : null}
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('close')}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              disabled={decide.isPending}
              onClick={() => decide.mutate('REJECT')}
            >
              {t('submissions.rejectButton')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={decide.isPending}
              onClick={() => decide.mutate('REQUEST_CHANGES')}
            >
              {t('submissions.requestChangesButton')}
            </Button>
            <Button
              type="button"
              disabled={decide.isPending}
              onClick={() => decide.mutate('APPROVE')}
            >
              {t('submissions.approveButton')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The draft file itself: plays a video, shows an image, links anything else. */
function DraftPreview({ file }: { file: NonNullable<DeliverableSubmissionDTO['attachment']> }) {
  const t = useTranslations('campaigns');
  const url = toBrowserUrl(file.downloadUrl);
  return (
    <div className="space-y-1.5">
      {file.kind === 'video' ? (
        <video
          src={url}
          controls
          playsInline
          className="max-h-[50dvh] w-full rounded-lg bg-black object-contain"
        />
      ) : file.kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not an optimisable asset
        <img
          src={url}
          alt={file.fileName}
          className="bg-surface-muted max-h-[50dvh] w-full rounded-lg object-contain"
        />
      ) : null}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-brand inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm font-medium hover:underline"
      >
        <Download className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{t('submissions.downloadFile', { name: file.fileName })}</span>
      </a>
    </div>
  );
}
