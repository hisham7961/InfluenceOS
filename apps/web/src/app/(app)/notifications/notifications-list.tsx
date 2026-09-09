'use client';

import * as React from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isThisWeek, isToday, isYesterday, parseISO } from 'date-fns';
import {
  Bell,
  CalendarClock,
  CheckCheck,
  Clock,
  Inbox,
  PlaySquare,
  RefreshCcw,
  ShieldAlert,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { NotificationCategory, NotificationDTO, Tone } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const LIMIT = 30;
type Filter = 'all' | 'unread';

const CATEGORY_ICON: Record<NotificationCategory, LucideIcon> = {
  CONTENT_REMOVED: ShieldAlert,
  CONTENT_UNAVAILABLE: ShieldAlert,
  DELIVERABLE_OVERDUE: Clock,
  DELIVERABLE_DUE_SOON: Clock,
  CAMPAIGN_ENDING: CalendarClock,
  SYNC_FAILURE: RefreshCcw,
  NEW_CONTENT: PlaySquare,
  FOLLOWER_MILESTONE: TrendingUp,
  GENERAL: Bell,
};

const CATEGORY_TONE: Record<NotificationCategory, Tone> = {
  CONTENT_REMOVED: 'danger',
  CONTENT_UNAVAILABLE: 'danger',
  DELIVERABLE_OVERDUE: 'danger',
  DELIVERABLE_DUE_SOON: 'warning',
  CAMPAIGN_ENDING: 'warning',
  SYNC_FAILURE: 'danger',
  NEW_CONTENT: 'info',
  FOLLOWER_MILESTONE: 'success',
  GENERAL: 'neutral',
};

const TONE_ICON_CLASS: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-muted-foreground',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  accent: 'bg-accent/10 text-accent',
};

/** Buckets a notification's timestamp into a section label, newest-first. */
function bucketFor(createdAt: string): string {
  const d = parseISO(createdAt);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  if (isThisWeek(d, { weekStartsOn: 1 })) return 'This week';
  return 'Earlier';
}

function groupByBucket(items: NotificationDTO[]): { bucket: string; items: NotificationDTO[] }[] {
  const groups: { bucket: string; items: NotificationDTO[] }[] = [];
  for (const item of items) {
    const bucket = bucketFor(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.bucket === bucket) last.items.push(item);
    else groups.push({ bucket, items: [item] });
  }
  return groups;
}

/**
 * Notification center: the full cursor-paginated history behind the topbar's
 * bell popover. Client-driven end to end — the page shell fetches nothing, so
 * this owns its own query, the unread filter, and mark-as-read mutations.
 */
export function NotificationsList() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<Filter>('all');

  function onError(e: unknown) {
    toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
  }

  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.notifications.unreadCount(),
    refetchInterval: 60_000,
  });
  const unreadCount = unreadQuery.data?.count ?? 0;

  const query = useInfiniteQuery({
    queryKey: ['notifications', 'list', filter] as const,
    queryFn: ({ pageParam }) =>
      api.notifications.list({
        cursor: pageParam,
        limit: LIMIT,
        unreadOnly: filter === 'unread' || undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined),
    staleTime: 15_000,
  });

  React.useEffect(() => {
    if (query.error) onError(query.error);
  }, [query.error]);

  const items = React.useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);
  const groups = React.useMemo(() => groupByBucket(items), [items]);
  const isInitialLoading = query.isLoading && items.length === 0;

  const markAllRead = useMutation({
    mutationFn: () => api.notifications.markRead({ all: true }),
    onSuccess: (res) => {
      if (res.updated > 0) toast.success(`Marked ${res.updated} notification${res.updated === 1 ? '' : 's'} as read`);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError,
  });

  const markOneRead = useMutation({
    mutationFn: (id: string) => api.notifications.markRead({ ids: [id] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  function handleRowClick(notification: NotificationDTO) {
    if (!notification.isRead) markOneRead.mutate(notification.id);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">Unread{unreadCount > 0 ? ` (${unreadCount > 99 ? '99+' : unreadCount})` : ''}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="outline"
          size="sm"
          disabled={unreadCount === 0 || markAllRead.isPending}
          onClick={() => markAllRead.mutate()}
        >
          <CheckCheck className="h-3.5 w-3.5" />
          {markAllRead.isPending ? 'Marking…' : 'Mark all as read'}
        </Button>
      </div>

      {isInitialLoading ? (
        <NotificationsSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="You're all caught up"
          description={
            filter === 'unread'
              ? 'No unread notifications right now.'
              : 'Alerts about content, deliverables, campaigns, and account activity will show up here.'
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group, idx) => (
            <section key={`${group.bucket}-${idx}`}>
              <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.bucket}
              </p>
              <Card className="divide-y divide-border overflow-hidden">
                {group.items.map((notification) => (
                  <NotificationRow key={notification.id} notification={notification} onClick={handleRowClick} />
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}

      {items.length > 0 && query.hasNextPage ? (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function NotificationRow({
  notification,
  onClick,
}: {
  notification: NotificationDTO;
  onClick: (notification: NotificationDTO) => void;
}) {
  const Icon = CATEGORY_ICON[notification.category];
  const tone = CATEGORY_TONE[notification.category];

  const body = (
    <div
      className={cn(
        'flex items-start gap-3.5 p-4 transition-colors',
        notification.targetUrl && 'cursor-pointer hover:bg-surface-muted',
        !notification.isRead && 'bg-brand-soft/30',
      )}
    >
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', TONE_ICON_CLASS[tone])}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <p className={cn('truncate text-sm leading-snug', !notification.isRead && 'font-semibold')}>
            {notification.title}
          </p>
          {!notification.isRead ? (
            <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />
          ) : null}
        </div>
        {notification.body ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{notification.body}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">{relativeTime(notification.createdAt)}</p>
      </div>
    </div>
  );

  if (notification.targetUrl) {
    return (
      <Link href={notification.targetUrl} onClick={() => onClick(notification)} className="block">
        {body}
      </Link>
    );
  }

  return (
    <div role={notification.isRead ? undefined : 'button'} onClick={() => onClick(notification)}>
      {body}
    </div>
  );
}

function NotificationsSkeleton() {
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3.5 p-4">
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </Card>
  );
}
