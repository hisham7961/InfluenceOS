'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Activity as ActivityIcon } from 'lucide-react';
import { api } from '@/lib/api-browser';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { BidiText } from '@/components/common/bidi-text';
import { useLocalizedFormat } from '@/lib/format';

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
  emptyTitle,
  emptyDescription,
}: {
  filter: {
    campaignId?: string;
    influencerId?: string;
    brandId?: string;
    /** Content detail/viewer's Activity section. */
    publishedContentId?: string;
    /** Logistics shipment detail's Activity section. */
    shipmentId?: string;
    limit?: number;
  };
  queryKey: readonly unknown[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const t = useTranslations('common');
  const { relativeTime } = useLocalizedFormat();
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
        title={t('couldntLoadActivity')}
        description={t('activityLoadError')}
      />
    );
  }

  const items = data?.data ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title={emptyTitle ?? t('noActivityYet')}
        description={emptyDescription ?? t('activityWillAppearHere')}
      />
    );
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
              {a.actorName ? (
                <>
                  <BidiText as="span">{a.actorName}</BidiText>{' · '}
                </>
              ) : null}
              {relativeTime(a.createdAt)}
            </p>
          </div>
        </div>
      ))}
    </Card>
  );
}
