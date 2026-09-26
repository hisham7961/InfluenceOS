'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ClipboardCheck, ExternalLink } from 'lucide-react';
import { SUBMISSION_STATUS_TONE } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { useLocalizedFormat } from '@/lib/format';

/**
 * Creator 360 UGC tab (gap #11) — every DeliverableSubmission (draft/review)
 * across every campaign this creator has ever been on, in one place, instead
 * of only the per-campaign Submissions tab. Reuses the exact submission-status
 * badge (SUBMISSION_STATUS_LABELS/SUBMISSION_STATUS_TONE) the campaign
 * Submissions tab already renders with — never a new status component.
 * Lazily fetched: mounts (and queries) only once this tab is actually opened
 * (TabsContent unmounts inactive panels by default), never alongside the
 * Creator 360 snapshot header.
 */
export function CreatorSubmissionsTab({ influencerId }: { influencerId: string }) {
  const t = useTranslations('influencers');
  const te = useTranslations('enums');
  const { relativeTime } = useLocalizedFormat();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['creator-submissions', influencerId],
    queryFn: () => api.influencers.submissions(influencerId),
  });

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
        title={t('detail.submissions.errorTitle')}
        description={t('detail.submissions.errorDescription')}
      />
    );
  }

  const submissions = data ?? [];

  if (submissions.length === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title={t('detail.submissions.emptyTitle')}
        description={t('detail.submissions.emptyDescription')}
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      <TableScroll>
        <Table className="min-w-[860px]">
          <TableHead>
            <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
              <TableHeaderCell className="ps-5">{t('detail.submissions.table.campaign')}</TableHeaderCell>
              <TableHeaderCell align="end">{t('detail.submissions.table.version')}</TableHeaderCell>
              <TableHeaderCell>{t('detail.submissions.table.submitted')}</TableHeaderCell>
              <TableHeaderCell>{t('detail.submissions.table.reviewer')}</TableHeaderCell>
              <TableHeaderCell>{t('detail.submissions.table.reviewNotes')}</TableHeaderCell>
              <TableHeaderCell align="end" className="pe-5">
                {t('detail.submissions.table.status')}
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {submissions.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="ps-5 max-w-[200px] font-medium">
                  <Link href={`/campaigns/${s.campaignId}?tab=submissions`} className="truncate text-brand hover:underline">
                    {s.campaignName}
                  </Link>
                </TableCell>
                <TableCell align="end" className="tabular-nums">
                  v{s.version}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {s.fromCreator ? t('detail.submissions.fromCreator') : (s.submittedByName ?? '—')} · {relativeTime(s.createdAt)}
                </TableCell>
                <TableCell className="text-muted-foreground">{s.reviewedByName ?? '—'}</TableCell>
                <TableCell className="max-w-[260px] truncate text-muted-foreground">
                  {s.reviewNote ?? s.notes ?? '—'}
                </TableCell>
                <TableCell align="end" className="pe-5">
                  <span className="inline-flex items-center gap-2">
                    {s.assetUrl ? (
                      <a
                        href={s.assetUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={t('detail.submissions.openAssetAriaLabel')}
                        className="text-muted-foreground hover:text-brand"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    <Badge tone={SUBMISSION_STATUS_TONE[s.status]}>{enumLabel(te, 'submissionStatus', s.status)}</Badge>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
    </Card>
  );
}
