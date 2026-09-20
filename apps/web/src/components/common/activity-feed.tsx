'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Activity as ActivityIcon } from 'lucide-react';
import { api } from '@/lib/api-browser';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { relativeTime } from '@/lib/format';

/**
 * ONE activity/operational-timeline renderer, reused everywhere a scoped
 * ActivityLog feed is shown (Campaign, Influencer, and anywhere else that
 * needs one) — never a duplicate history table (see
 * docs/workflow/WORKFLOW_GAP_MATRIX.md, "Influencer Operational Timeline").
 * ActivityLog already records campaign joins, deliverable/status changes,
 * shipment status transitions, content publishes and cost entries; this
 * component just queries it scoped to whichever id was passed in.
 */
export function ActivityFeed({
  filter,
  queryKey,
  emptyTitle = 'No activity yet',
  emptyDescription = 'Actions taken here will show up in this timeline.',
}: {
  filter: { campaignId?: string; influencerId?: string; brandId?: string; limit?: number };
  queryKey: readonly unknown[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => api.activity.feed(filter),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title="Couldn't load activity"
        description="Something went wrong fetching the activity feed. Try again shortly."
      />
    );
  }

  const items = data?.data ?? [];
  if (items.length === 0) {
    return <EmptyState icon={ActivityIcon} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <Card className="divide-y divide-border">
      {items.map((a) => (
        <div key={a.id} className="flex items-start gap-3 p-4">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
          <div className="min-w-0 flex-1">
            {a.link ? (
              <Link href={a.link} className="text-sm leading-snug hover:underline">
                {a.message}
              </Link>
            ) : (
              <p className="text-sm leading-snug">{a.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {a.actorName ? `${a.actorName} · ` : ''}
              {relativeTime(a.createdAt)}
            </p>
          </div>
        </div>
      ))}
    </Card>
  );
}
