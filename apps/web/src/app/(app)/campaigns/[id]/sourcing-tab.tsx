'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { UserSearch } from 'lucide-react';
import { CANDIDATE_STATUS_TONE } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { ImportCandidatesDialog } from './import-candidates-dialog';

/** Sourcing pipeline for a campaign (W3-3 web surface): the shortlist of
 *  candidates with their status, fit score and decision. Read-only, plus a
 *  bulk CSV creator intake (W3-4) that feeds the pipeline in one request. */
export function SourcingTab({ campaignId }: { campaignId: string }) {
  const t = useTranslations('campaigns');
  const tEnums = useTranslations('enums');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-candidates', campaignId],
    queryFn: () => api.campaigns.candidates(campaignId),
  });

  const candidates = data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t('sourcing.title')}</h3>
          <p className="text-xs text-muted-foreground">
            {candidates.length > 0 ? t('sourcing.candidateCount', { count: candidates.length }) : t('sourcing.subtitleEmpty')}
          </p>
        </div>
        <ImportCandidatesDialog campaignId={campaignId} />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState icon={UserSearch} title={t('sourcing.loadErrorTitle')} description={t('sourcing.loadErrorDescription')} />
      ) : candidates.length === 0 ? (
        <EmptyState icon={UserSearch} title={t('sourcing.emptyTitle')} description={t('sourcing.emptyDescription')} />
      ) : (
        <Card className="overflow-hidden">
          <TableScroll>
            <Table className="min-w-[720px]">
              <TableHead>
                <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                  <TableHeaderCell className="ps-5">{t('sourcing.creatorHeader')}</TableHeaderCell>
                  <TableHeaderCell align="end">{t('sourcing.fitHeader')}</TableHeaderCell>
                  <TableHeaderCell>{t('fields.notes')}</TableHeaderCell>
                  <TableHeaderCell>{t('sourcing.decisionHeader')}</TableHeaderCell>
                  <TableHeaderCell align="end">{t('fields.status')}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {candidates.map((cand) => (
                  <TableRow key={cand.id}>
                    <TableCell className="ps-5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={cand.influencer.displayName} src={cand.influencer.avatarUrl ?? undefined} size="xs" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            <BidiText>{cand.influencer.displayName}</BidiText>
                          </p>
                          {cand.influencer.primaryUsername ? (
                            <p className="truncate text-xs text-muted-foreground">
                              <LtrText>@{cand.influencer.primaryUsername}</LtrText>
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell align="end">{cand.fitScore == null ? '—' : cand.fitScore}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">{cand.notes ?? '—'}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">{cand.decisionReason ?? '—'}</TableCell>
                    <TableCell align="end">
                      <Badge tone={CANDIDATE_STATUS_TONE[cand.status]}>{enumLabel(tEnums, 'candidateStatus', cand.status)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        </Card>
      )}
    </div>
  );
}
