'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Clock, FileCheck, History, MessageSquare, Package, PhoneCall, PlaySquare, Sparkles, Wallet } from 'lucide-react';
import type { CreatorTimelineItemDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PageFooter } from '@/components/ui/page-footer';
import { useLocalizedFormat } from '@/lib/format';
import { cn } from '@/lib/cn';

type Bucket = CreatorTimelineItemDTO['bucket'];
const BUCKET_ALL = 'ALL';

const BUCKET_ICON: Record<Bucket, React.ComponentType<{ className?: string }>> = {
  campaign: History,
  content: PlaySquare,
  ugc: Sparkles,
  logistics: Package,
  payment: Wallet,
  // gap #12's "Notes" bucket label reuses the `collaboration` DTO bucket key.
  collaboration: MessageSquare,
  activity: Clock,
  // gap #12 — Contacted (CampaignInfluencer.dateContacted) and Usage Rights
  // (UsageRight.createdAt), distinct from the general 'activity' bucket.
  contacted: PhoneCall,
  usageRights: FileCheck,
};

/**
 * The Creator Master Timeline (Operations Intelligence pass, PART 29-30) —
 * a unified, filterable, human-readable chronology distinct from Chat: this
 * is system-recorded fact (what happened), never a discussion thread.
 * Reuses ActivityLog/Note/DeliverableSubmission via creator360.timeline();
 * see that service for why Notification rows are deliberately excluded.
 */
export function CreatorTimeline({ influencerId }: { influencerId: string }) {
  const t = useTranslations('influencers');
  const { relativeTime } = useLocalizedFormat();
  const [bucket, setBucket] = React.useState<Bucket | typeof BUCKET_ALL>(BUCKET_ALL);
  const [page, setPage] = React.useState(1);

  const BUCKET_LABEL: Record<Bucket, string> = {
    campaign: t('detail.timeline.buckets.campaign'),
    content: t('detail.timeline.buckets.content'),
    ugc: t('detail.timeline.buckets.ugc'),
    logistics: t('detail.timeline.buckets.logistics'),
    payment: t('detail.timeline.buckets.payment'),
    collaboration: t('detail.timeline.buckets.notes'),
    activity: t('detail.timeline.buckets.activity'),
    contacted: t('detail.timeline.buckets.contacted'),
    usageRights: t('detail.timeline.buckets.usageRights'),
  };

  const query = useQuery({
    queryKey: ['creator-timeline', influencerId, page],
    queryFn: () => api.influencers.timeline(influencerId, { limit: 30, page }),
    placeholderData: keepPreviousData,
  });
  const items: CreatorTimelineItemDTO[] = query.data?.data ?? [];

  const filtered = bucket === BUCKET_ALL ? items : items.filter((i) => i.bucket === bucket);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <Button variant={bucket === BUCKET_ALL ? 'secondary' : 'ghost'} size="sm" onClick={() => setBucket(BUCKET_ALL)}>
          {t('detail.timeline.all')}
        </Button>
        {(Object.keys(BUCKET_ICON) as Bucket[]).map((b) => {
          const Icon = BUCKET_ICON[b];
          return (
            <Button key={b} variant={bucket === b ? 'secondary' : 'ghost'} size="sm" onClick={() => setBucket(b)}>
              <Icon className="h-3.5 w-3.5" /> {BUCKET_LABEL[b]}
            </Button>
          );
        })}
      </div>

      {query.isLoading && items.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={History}
          title={t('detail.timeline.emptyTitle')}
          description={t('detail.timeline.emptyDescription')}
        />
      ) : (
        <ul className="space-y-1">
          {filtered.map((item) => {
            const Icon = BUCKET_ICON[item.bucket];
            const Row = (
              <div className="flex items-start gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-surface-muted">
                <div className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted-foreground')}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground">{item.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {BUCKET_LABEL[item.bucket]} · {relativeTime(item.at)}
                  </p>
                </div>
              </div>
            );
            return <li key={item.id}>{item.link ? <Link href={item.link}>{Row}</Link> : Row}</li>;
          })}
        </ul>
      )}

      <PageFooter pagination={query.data?.pagination} onPageChange={setPage} />
    </div>
  );
}
