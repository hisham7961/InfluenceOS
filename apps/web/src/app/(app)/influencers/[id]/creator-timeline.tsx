'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Clock, FileCheck, History, MessageSquare, Package, PhoneCall, PlaySquare, Sparkles, Wallet } from 'lucide-react';
import type { CreatorTimelineItemDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

type Bucket = CreatorTimelineItemDTO['bucket'];
const BUCKET_ALL = 'ALL';

const BUCKET_META: Record<Bucket, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  campaign: { label: 'Campaign', icon: History },
  content: { label: 'Content', icon: PlaySquare },
  ugc: { label: 'UGC', icon: Sparkles },
  logistics: { label: 'Logistics', icon: Package },
  payment: { label: 'Payment', icon: Wallet },
  collaboration: { label: 'Notes', icon: MessageSquare },
  activity: { label: 'Activity', icon: Clock },
  // gap #12 — Contacted (CampaignInfluencer.dateContacted) and Usage Rights
  // (UsageRight.createdAt), distinct from the general 'activity' bucket.
  contacted: { label: 'Contacted', icon: PhoneCall },
  usageRights: { label: 'Usage Rights', icon: FileCheck },
};

/**
 * The Creator Master Timeline (Operations Intelligence pass, PART 29-30) —
 * a unified, filterable, human-readable chronology distinct from Chat: this
 * is system-recorded fact (what happened), never a discussion thread.
 * Reuses ActivityLog/Note/DeliverableSubmission via creator360.timeline();
 * see that service for why Notification rows are deliberately excluded.
 */
export function CreatorTimeline({ influencerId }: { influencerId: string }) {
  const [bucket, setBucket] = React.useState<Bucket | typeof BUCKET_ALL>(BUCKET_ALL);
  const [cursor, setCursor] = React.useState<string | undefined>(undefined);
  const [items, setItems] = React.useState<CreatorTimelineItemDTO[]>([]);

  const query = useQuery({
    queryKey: ['creator-timeline', influencerId, cursor],
    queryFn: () => api.influencers.timeline(influencerId, { limit: 30, cursor }),
  });

  React.useEffect(() => {
    if (!query.data) return;
    setItems((prev) => (cursor ? [...prev, ...query.data.data] : query.data.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  const filtered = bucket === BUCKET_ALL ? items : items.filter((i) => i.bucket === bucket);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <Button variant={bucket === BUCKET_ALL ? 'secondary' : 'ghost'} size="sm" onClick={() => setBucket(BUCKET_ALL)}>
          All
        </Button>
        {(Object.keys(BUCKET_META) as Bucket[]).map((b) => {
          const meta = BUCKET_META[b];
          const Icon = meta.icon;
          return (
            <Button key={b} variant={bucket === b ? 'secondary' : 'ghost'} size="sm" onClick={() => setBucket(b)}>
              <Icon className="h-3.5 w-3.5" /> {meta.label}
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
          title="Nothing here yet"
          description="Campaign joins, deliverables, shipments, content, payments, submissions and notes will show up here as they happen."
        />
      ) : (
        <ul className="space-y-1">
          {filtered.map((item) => {
            const meta = BUCKET_META[item.bucket];
            const Icon = meta.icon;
            const Row = (
              <div className="flex items-start gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-surface-muted">
                <div className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted-foreground')}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground">{item.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {meta.label} · {relativeTime(item.at)}
                  </p>
                </div>
              </div>
            );
            return <li key={item.id}>{item.link ? <Link href={item.link}>{Row}</Link> : Row}</li>;
          })}
        </ul>
      )}

      {query.data?.hasMore && query.data.nextCursor && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => setCursor(query.data!.nextCursor!)}>
            {query.isFetching ? 'Loading…' : 'Load earlier'}
          </Button>
        </div>
      )}
    </div>
  );
}
