'use client';

import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { CursorPage, PublishedContentDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { PageFooter } from '@/components/ui/page-footer';
import { ContentGrid } from './content-grid';
import { CONTENT_GRID_PAGE_SIZE } from './content-page-size';

/**
 * A creator's, brand's or campaign's posts, newest first, a page at a time —
 * every post is reachable, not just the first dozen. Page 1 comes from the
 * server render.
 */
export function PagedContentGrid({
  filter,
  initial,
  emptyTitle,
  emptyDescription,
}: {
  filter: { brandId?: string; influencerId?: string; campaignId?: string };
  initial?: CursorPage<PublishedContentDTO>;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [page, setPage] = React.useState(1);
  const query = useQuery({
    queryKey: ['content-feed', 'grid', filter, page] as const,
    queryFn: () => api.content.feed({ ...filter, page, limit: CONTENT_GRID_PAGE_SIZE }),
    initialData: page === 1 ? initial : undefined,
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <ContentGrid items={query.data?.data ?? []} emptyTitle={emptyTitle} emptyDescription={emptyDescription} />
      <PageFooter pagination={query.data?.pagination} onPageChange={setPage} />
    </div>
  );
}
