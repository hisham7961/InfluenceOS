'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import type { CampaignInfluencerDTO } from '@influenceos/contracts';
import { DELIVERABLE_TYPE_LABELS, SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_TONE } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { relativeTime } from '@/lib/format';

/** Submission review queue for a campaign (W3-1 web surface): every draft
 *  submitted across the campaign's deliverables with its version, review status
 *  and reviewer — so "what's waiting on me?" is answerable. Read-only. */
export function SubmissionsTab({ campaignId, influencers }: { campaignId: string; influencers: CampaignInfluencerDTO[] }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-submissions', campaignId],
    queryFn: () => api.campaigns.submissions(campaignId),
  });

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
          <Table className="min-w-[760px]">
            <TableHead>
              <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                <TableHeaderCell className="ps-5">Creator</TableHeaderCell>
                <TableHeaderCell>Deliverable</TableHeaderCell>
                <TableHeaderCell align="end">Ver.</TableHeaderCell>
                <TableHeaderCell>Submitted</TableHeaderCell>
                <TableHeaderCell>Reviewer</TableHeaderCell>
                <TableHeaderCell align="end">Status</TableHeaderCell>
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
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
      </Card>
    </div>
  );
}
