'use client';

import * as React from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import type { ActivityDTO, CursorPage } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { dateTime, relativeTime } from '@/lib/format';

/** Admin audit log — the workspace-wide activity stream with cursor paging. */
export function AuditLogClient({ initial }: { initial: CursorPage<ActivityDTO> }) {
  const query = useInfiniteQuery({
    queryKey: ['audit-log'],
    queryFn: ({ pageParam }) => api.activity.feed({ cursor: pageParam, limit: 40 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    initialData: { pages: [initial], pageParams: [undefined] },
    staleTime: 15_000,
  });

  const items = React.useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        title="No activity yet"
        description="Actions taken across the workspace will be recorded here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card className="divide-y divide-border p-0">
        {items.map((entry) => (
          <div key={entry.id} className="flex items-start gap-3 p-4">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
            <div className="min-w-0 flex-1">
              {entry.link ? (
                <Link href={entry.link} className="text-sm leading-snug hover:underline">
                  {entry.message}
                </Link>
              ) : (
                <p className="text-sm leading-snug">{entry.message}</p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground" title={dateTime(entry.createdAt)}>
                {entry.actorName ? `${entry.actorName} · ` : ''}
                {relativeTime(entry.createdAt)}
              </p>
            </div>
            <Badge tone="neutral" className="shrink-0 font-mono text-[10px]">
              {entry.type}
            </Badge>
          </div>
        ))}
      </Card>

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
