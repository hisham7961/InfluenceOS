'use client';

import * as React from 'react';
import Link from 'next/link';
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
import { cn } from '@/lib/cn';

const STAGE_LABELS: Record<CampaignOperationsStageDTO['key'], string> = {
  agreement: 'Agreement',
  product: 'Product',
  contentDue: 'Content Due',
  draft: 'Draft',
  review: 'Review',
  approved: 'Approved',
  published: 'Published',
  payment: 'Payment',
};

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

const FILTER_CHIPS: { key: CampaignOperationsRowDTO['filterBuckets'][number]; label: string }[] = [
  { key: 'needsAttention', label: 'Needs Attention' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'waitingForProduct', label: 'Waiting on Product' },
  { key: 'waitingForCreator', label: 'Waiting on Creator' },
  { key: 'inReview', label: 'In Review' },
  { key: 'readyToPublish', label: 'Ready to Publish' },
  { key: 'published', label: 'Published' },
  { key: 'paymentPending', label: 'Payment Pending' },
  { key: 'onTrack', label: 'On Track' },
  { key: 'completed', label: 'Completed' },
];

const ALL = 'ALL';

function StageCell({ stage }: { stage: CampaignOperationsStageDTO }) {
  const Icon = STATE_ICON[stage.state];
  const cell = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs',
        stage.state === 'na' ? 'text-muted-foreground/50' : `text-${STATE_TONE[stage.state]}`,
      )}
      title={stage.detail ?? STAGE_LABELS[stage.key]}
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
  const [filter, setFilter] = React.useState<CampaignOperationsRowDTO['filterBuckets'][number] | typeof ALL>(ALL);

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
    return <EmptyState icon={TriangleAlert} title="Couldn't load the operations board" description="Try reloading the page." />;
  }
  if (rows.length === 0) {
    return <EmptyState icon={Circle} title="No influencers on this campaign yet" description="Add influencers to the roster to see their stage pipeline here." />;
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
          All ({rows.length})
        </Button>
        {FILTER_CHIPS.map((c) => {
          const count = rows.filter((r) => r.filterBuckets.includes(c.key)).length;
          if (count === 0) return null;
          return (
            <Button key={c.key} variant={filter === c.key ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter(c.key)}>
              {c.label} ({count})
            </Button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Circle} title="No matches" description="No influencer on this roster matches the selected filter." />
      ) : (
        <TableScroll>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Influencer</TableHeaderCell>
                {stageKeys.map((k) => (
                  <TableHeaderCell key={k} align="center">
                    {STAGE_LABELS[k]}
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
                      <span className="font-medium text-foreground">{row.influencerName}</span>
                    </Link>
                  </TableCell>
                  {row.stages.map((stage) => (
                    <TableCell key={stage.key} align="center">
                      <StageCell stage={stage} />
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
          <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Done
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-warning" /> Pending
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Circle className="h-3.5 w-3.5 text-info" /> Waiting
        </span>
        <span className="inline-flex items-center gap-1.5">
          <TriangleAlert className="h-3.5 w-3.5 text-danger" /> Overdue
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Minus className="h-3.5 w-3.5 text-muted-foreground/50" /> Not applicable
        </span>
      </div>
    </div>
  );
}
