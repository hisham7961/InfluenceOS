'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Circle, Clock, Minus, TriangleAlert } from 'lucide-react';
import type { CampaignOperationsRowDTO, CampaignOperationsStageDTO, Tone } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { BidiText } from '@/components/common/bidi-text';
import { cn } from '@/lib/cn';

const STATE_ICON: Record<CampaignOperationsStageDTO['state'], React.ComponentType<{ className?: string }>> = {
  done: CheckCircle2,
  pending: Clock,
  overdue: TriangleAlert,
  waiting: Circle,
  na: Minus,
};

const STATE_TONE: Record<CampaignOperationsStageDTO['state'], Tone> = {
  done: 'success',
  pending: 'warning',
  overdue: 'danger',
  waiting: 'info',
  na: 'neutral',
};

const FILTER_CHIP_KEYS: CampaignOperationsRowDTO['filterBuckets'][number][] = [
  'needsAttention',
  'overdue',
  'waitingForProduct',
  'waitingForCreator',
  'inReview',
  'readyToPublish',
  'published',
  'paymentPending',
  'onTrack',
  'completed',
];

const ALL = 'ALL';

function StageCell({ stage, stageLabels }: { stage: CampaignOperationsStageDTO; stageLabels: Record<string, string> }) {
  const Icon = STATE_ICON[stage.state];
  const cell = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs',
        stage.state === 'na' ? 'text-muted-foreground/50' : `text-${STATE_TONE[stage.state]}`,
      )}
      title={stage.detail ?? stageLabels[stage.key]}
    >
      <Icon className="h-4 w-4 shrink-0" />
    </span>
  );
  return stage.link ? (
    <Link href={stage.link} className="inline-flex hover:opacity-70">
      {cell}
    </Link>
  ) : (
    cell
  );
}

/**
 * The Campaign Operations Board (Operations Intelligence pass, PART 33-36) —
 * one row per influencer on the roster, 8 read-time-derived stage columns
 * (see campaign-operations.service.ts). No stage is a stored status — every
 * icon here reflects real CampaignInfluencer/Deliverable/Submission/Shipment
 * records at the moment the page loads.
 */
export function OperationsBoardTab({ campaignId }: { campaignId: string }) {
  const t = useTranslations('campaigns');
  const [filter, setFilter] = React.useState<CampaignOperationsRowDTO['filterBuckets'][number] | typeof ALL>(ALL);

  const stageLabels: Record<CampaignOperationsStageDTO['key'], string> = {
    agreement: t('operations.stages.agreement'),
    product: t('operations.stages.product'),
    contentDue: t('operations.stages.contentDue'),
    draft: t('operations.stages.draft'),
    review: t('operations.stages.review'),
    approved: t('operations.stages.approved'),
    published: t('operations.stages.published'),
    payment: t('operations.stages.payment'),
  };

  const filterChips = FILTER_CHIP_KEYS.map((key) => ({ key, label: t(`operations.filters.${key}`) }));

  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-operations-board', campaignId],
    queryFn: () => api.campaigns.operationsBoard(campaignId),
  });

  // The SAME canonical Needs Attention list Mission Control renders
  // (dashboard.service.ts::attention()), scoped to this campaign — a real
  // slice of that one source, not a second calculation. This is additional
  // to the per-row derived stage state above: it also surfaces item kinds
  // the stage columns don't carry, such as a usage right expiring soon.
  const { data: attention } = useQuery({
    queryKey: ['campaign-attention', campaignId],
    queryFn: () => api.dashboard.attention({ campaignId }),
  });

  const rows = data?.rows ?? [];
  const filtered = filter === ALL ? rows : rows.filter((r) => r.filterBuckets.includes(filter));

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title={t('operations.loadErrorTitle')}
        description={t('operations.loadErrorDescription')}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState icon={Circle} title={t('operations.emptyTitle')} description={t('operations.emptyDescription')} />
    );
  }

  const stageKeys = rows[0]!.stages.map((s) => s.key);

  return (
    <div className="space-y-4">
      {attention && attention.length > 0 ? (
        <Card className="divide-y divide-border">
          {attention.map((item) => (
            <Link key={item.id} href={item.link} className="flex items-start gap-3 p-3 transition-colors hover:bg-surface-muted">
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${item.severity === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}>
                <AlertTriangle className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-snug">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            </Link>
          ))}
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        <Button variant={filter === ALL ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter(ALL)}>
          {t('operations.chipWithCount', { label: t('operations.allChip'), count: rows.length })}
        </Button>
        {filterChips.map((c) => {
          const count = rows.filter((r) => r.filterBuckets.includes(c.key)).length;
          if (count === 0) return null;
          return (
            <Button key={c.key} variant={filter === c.key ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter(c.key)}>
              {t('operations.chipWithCount', { label: c.label, count })}
            </Button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Circle} title={t('operations.noMatches')} description={t('operations.noMatchesDescription')} />
      ) : (
        <TableScroll>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t('operations.influencerHeader')}</TableHeaderCell>
                {stageKeys.map((k) => (
                  <TableHeaderCell key={k} align="center">
                    {stageLabels[k]}
                  </TableHeaderCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.campaignInfluencerId}>
                  <TableCell>
                    <Link href={`/influencers/${row.influencerId}`} className="flex items-center gap-2 hover:underline">
                      <Avatar name={row.influencerName} src={row.influencerAvatarUrl} size="sm" />
                      <span className="font-medium text-foreground">
                        <BidiText>{row.influencerName}</BidiText>
                      </span>
                    </Link>
                  </TableCell>
                  {row.stages.map((stage) => (
                    <TableCell key={stage.key} align="center">
                      <StageCell stage={stage} stageLabels={stageLabels} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {t('operations.legend.done')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-warning" /> {t('operations.legend.pending')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Circle className="h-3.5 w-3.5 text-info" /> {t('operations.legend.waiting')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <TriangleAlert className="h-3.5 w-3.5 text-danger" /> {t('operations.legend.overdue')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Minus className="h-3.5 w-3.5 text-muted-foreground/50" /> {t('operations.legend.notApplicable')}
        </span>
      </div>
    </div>
  );
}
