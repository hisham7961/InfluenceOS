'use client';

import * as React from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Eye,
  ExternalLink,
  Heart,
  LayoutGrid,
  LayoutPanelTop,
  MessageCircle,
  PlaySquare,
  Rows3,
  Search,
  Share2,
  X,
} from 'lucide-react';
import type { BrandSummaryDTO, CursorPage, PublishedContentDTO } from '@influenceos/contracts';
import { CONTENT_STATUSES, CONTENT_STATUS_LABELS, PLATFORMS, PLATFORM_META } from '@influenceos/shared';
import { ApiError } from '@influenceos/api-client';
import { toast } from 'sonner';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { formatCompact, relativeTime } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { ContentStatusBadge } from '@/components/ui/status-badges';
import { DataSourceBadge } from '@/components/ui/provenance';
import { ContentGrid } from '@/components/content/content-grid';
import { ContentMasonry } from '@/components/content/content-masonry';
import { SocialContentPlayer } from '@/components/content/social-content-player';

/** Sentinel value for Radix Select's "no filter" option (Select forbids an empty-string item value). */
const ALL = 'all';

type Layout = 'grid' | 'masonry' | 'feed';

interface WallFilters {
  brandId: string;
  platform: string;
  status: string;
  q: string;
}

const EMPTY_FILTERS: WallFilters = { brandId: '', platform: '', status: '', q: '' };

/**
 * The Live Content wall: a social-discovery-style feed of every piece of
 * published content across brands. Filters + layout are managed entirely
 * client-side; cursor pagination is driven by useInfiniteQuery, seeded with
 * the server-rendered first page so the wall paints instantly.
 */
export function ContentWall({
  initial,
  brands,
}: {
  initial: CursorPage<PublishedContentDTO>;
  brands: BrandSummaryDTO[];
}) {
  const [filters, setFilters] = React.useState<WallFilters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = React.useState('');
  const [layout, setLayout] = React.useState<Layout>('grid');

  // Debounce free-text search into the active filter set that drives the query.
  React.useEffect(() => {
    const handle = setTimeout(() => {
      const q = searchInput.trim();
      setFilters((f) => (f.q === q ? f : { ...f, q }));
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const hasActiveFilters = Boolean(filters.brandId || filters.platform || filters.status || filters.q);
  const isDefaultFilters = !hasActiveFilters;

  const query = useInfiniteQuery({
    queryKey: ['content-feed', filters] as const,
    queryFn: ({ pageParam }) =>
      api.content.feed({
        cursor: pageParam,
        limit: 24,
        brandId: filters.brandId || undefined,
        platform: filters.platform || undefined,
        status: filters.status || undefined,
        q: filters.q || undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined),
    initialData: isDefaultFilters ? () => ({ pages: [initial], pageParams: [undefined] }) : undefined,
    staleTime: 30_000,
  });

  const items = React.useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);

  React.useEffect(() => {
    if (query.error) {
      toast.error(query.error instanceof ApiError ? query.error.message : 'Could not load the content wall.');
    }
  }, [query.error]);

  function resetFilters() {
    setSearchInput('');
    setFilters(EMPTY_FILTERS);
  }

  const isInitialLoading = query.isLoading && items.length === 0;

  return (
    <div className="space-y-6">
      <FilterBar
        brands={brands}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        filters={filters}
        onFilterChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        onReset={resetFilters}
        hasActiveFilters={hasActiveFilters}
        layout={layout}
        onLayoutChange={setLayout}
        resultCount={items.length}
      />

      {isInitialLoading ? (
        <LoadingSkeleton layout={layout} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={PlaySquare}
          title={hasActiveFilters ? 'No content matches your filters' : 'Nothing live yet'}
          description={
            hasActiveFilters
              ? 'Try a different search term or clear your filters to see the full wall.'
              : 'Published influencer content will surface here the moment it goes live.'
          }
          action={
            hasActiveFilters ? (
              <Button variant="outline" onClick={resetFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : layout === 'grid' ? (
        <ContentGrid items={items} />
      ) : layout === 'masonry' ? (
        <ContentMasonry items={items} />
      ) : (
        <FeedLayout items={items} />
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

function FilterBar({
  brands,
  searchInput,
  onSearchChange,
  filters,
  onFilterChange,
  onReset,
  hasActiveFilters,
  layout,
  onLayoutChange,
  resultCount,
}: {
  brands: BrandSummaryDTO[];
  searchInput: string;
  onSearchChange: (value: string) => void;
  filters: WallFilters;
  onFilterChange: (patch: Partial<WallFilters>) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
  layout: Layout;
  onLayoutChange: (layout: Layout) => void;
  resultCount: number;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card lg:flex-row lg:items-center">
      <div className="relative flex-1 lg:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search caption or creator…"
          aria-label="Search content"
          className="pl-9"
        />
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-3">
        <Select value={filters.brandId || ALL} onValueChange={(value) => onFilterChange({ brandId: value === ALL ? '' : value })}>
          <SelectTrigger className="h-10 w-full sm:w-40">
            <SelectValue placeholder="Brand" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All brands</SelectItem>
            {brands.map((brand) => (
              <SelectItem key={brand.id} value={brand.id}>
                {brand.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.platform || ALL} onValueChange={(value) => onFilterChange({ platform: value === ALL ? '' : value })}>
          <SelectTrigger className="h-10 w-full sm:w-40">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All platforms</SelectItem>
            {PLATFORMS.map((platform) => (
              <SelectItem key={platform} value={platform}>
                {PLATFORM_META[platform].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.status || ALL} onValueChange={(value) => onFilterChange({ status: value === ALL ? '' : value })}>
          <SelectTrigger className="h-10 w-full sm:w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {CONTENT_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {CONTENT_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={onReset} className="text-muted-foreground">
            <X className="h-3.5 w-3.5" /> Reset
          </Button>
        ) : null}

        <span className="text-xs text-muted-foreground lg:ms-auto">
          {resultCount} loaded
        </span>
      </div>

      <Tabs value={layout} onValueChange={(value) => onLayoutChange(value as Layout)}>
        <TabsList>
          <TabsTrigger value="grid" aria-label="Grid layout">
            <LayoutGrid className="h-4 w-4" /> Grid
          </TabsTrigger>
          <TabsTrigger value="masonry" aria-label="Masonry layout">
            <LayoutPanelTop className="h-4 w-4" /> Masonry
          </TabsTrigger>
          <TabsTrigger value="feed" aria-label="Feed layout">
            <Rows3 className="h-4 w-4" /> Feed
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

function LoadingSkeleton({ layout }: { layout: Layout }) {
  if (layout === 'feed') {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-3xl border border-border bg-card shadow-card">
            <div className="flex items-center gap-3 p-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="space-y-2 p-4">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <Skeleton className="aspect-[4/5] w-full rounded-none" />
          <div className="space-y-2 p-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedLayout({ items }: { items: PublishedContentDTO[] }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      {items.map((content) => (
        <FeedCard key={content.id} content={content} />
      ))}
    </div>
  );
}

function FeedCard({ content }: { content: PublishedContentDTO }) {
  const m = content.metrics;

  return (
    <article className="overflow-hidden rounded-3xl border border-border bg-card shadow-card transition-shadow hover:shadow-pop">
      <div className="flex items-center gap-3 p-4">
        <Avatar name={content.influencer?.displayName ?? 'Unknown'} src={content.influencer?.avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          {content.influencer ? (
            <Link href={`/influencers/${content.influencer.id}`} className="truncate font-semibold hover:underline">
              {content.influencer.displayName}
            </Link>
          ) : (
            <p className="truncate font-semibold text-muted-foreground">Unassigned</p>
          )}
          <p className="truncate text-xs text-muted-foreground">
            {content.brand?.name ?? '—'}
            {content.campaign ? ` · ${content.campaign.name}` : ''}
          </p>
        </div>
        <PlatformBadge platform={content.platform} size="sm" />
        <ContentStatusBadge status={content.availabilityStatus} />
      </div>

      <SocialContentPlayer content={content} className="rounded-none" />

      <div className="flex flex-col gap-3 p-4">
        {content.caption ? (
          <p className="line-clamp-3 text-sm leading-relaxed text-foreground/90">{content.caption}</p>
        ) : null}

        <div className="flex items-center gap-5 text-sm text-muted-foreground">
          <FeedMetric icon={Eye} value={m?.views} />
          <FeedMetric icon={Heart} value={m?.likes} />
          <FeedMetric icon={MessageCircle} value={m?.comments} />
          <FeedMetric icon={Share2} value={m?.shares} />
          <span className="ms-auto text-xs">{relativeTime(content.publishedAt ?? content.detectedAt)}</span>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <DataSourceBadge source={m?.source ?? content.provenance.source} />
          <a
            href={content.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Open original <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
}

function FeedMetric({
  icon: Icon,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number | null | undefined;
}) {
  return (
    <span className={cn('flex items-center gap-1.5', value == null && 'opacity-50')}>
      <Icon className="h-4 w-4" />
      {value == null ? 'N/A' : formatCompact(value)}
    </span>
  );
}
