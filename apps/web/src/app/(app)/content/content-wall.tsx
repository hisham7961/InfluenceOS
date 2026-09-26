'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
  Sparkles,
  CalendarDays,
  Building2,
  X,
} from 'lucide-react';
import type { BrandSummaryDTO, CursorPage, PublishedContentDTO } from '@influenceos/contracts';
import {
  CONTENT_ASSOCIATION_STATUS_LABELS,
  CONTENT_STATUSES,
  PLATFORMS,
  PLATFORM_META,
  type ContentAssociationStatus,
} from '@influenceos/shared';
import { ApiError } from '@influenceos/api-client';
import { toast } from 'sonner';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { formatCompact, useLocalizedFormat } from '@/lib/format';
import { enumLabel } from '@/lib/enum-labels';
import { useReplaceQuery, useUrlPage } from '@/lib/use-url-page';
import { PageFooter } from '@/components/ui/page-footer';
import { WALL_PAGE_SIZE } from './wall-constants';
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
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { EntityCombobox } from '@/components/common/entity-combobox';
import { ContentGrid } from '@/components/content/content-grid';
import { ContentMasonry } from '@/components/content/content-masonry';
import { ContentTimeline } from '@/components/content/content-timeline';
import { ContentFilterChips, type ChipKey } from '@/components/content/filter-chips';
import { ReviewNewContentButton } from '@/components/content/review-new-content-button';
import { SocialContentPlayer } from '@/components/content/social-content-player';

/** Sentinel value for Radix Select's "no filter" option (Select forbids an empty-string item value). */
const ALL = 'all';

type Layout = 'timeline' | 'brand' | 'grid' | 'masonry' | 'feed';
const VALID_LAYOUTS: Layout[] = ['timeline', 'brand', 'grid', 'masonry', 'feed'];

interface WallFilters {
  brandId: string;
  campaignId: string;
  influencerId: string;
  platform: string;
  status: string;
  assignment: ContentAssociationStatus | '';
  reviewState: 'NEW' | 'SEEN' | 'REVIEWED' | 'REVIEW_LATER' | '';
  alertsOnly: boolean;
  /** Only posts that have no numbers yet. */
  metricsMissing: boolean;
  today: boolean;
  q: string;
}

const EMPTY_FILTERS: WallFilters = {
  brandId: '',
  campaignId: '',
  influencerId: '',
  platform: '',
  status: '',
  assignment: '',
  reviewState: '',
  alertsOnly: false,
  metricsMissing: false,
  today: false,
  q: '',
};

const ASSIGNMENTS: ContentAssociationStatus[] = ['FULLY_LINKED', 'CAMPAIGN_LINKED', 'INFLUENCER_LINKED', 'UNASSIGNED'];

/** Starting filters from the address, so links from Data Quality, the
 *  dashboard or a campaign open the wall already filtered. */
function filtersFromUrl(params: URLSearchParams | null): WallFilters {
  if (!params) return EMPTY_FILTERS;
  const assignment = params.get('assignment') as ContentAssociationStatus | null;
  const review = params.get('reviewState');
  return {
    ...EMPTY_FILTERS,
    brandId: params.get('brandId') ?? '',
    campaignId: params.get('campaignId') ?? '',
    influencerId: params.get('influencerId') ?? '',
    platform: params.get('platform') ?? '',
    status: params.get('status') ?? '',
    assignment: assignment && ASSIGNMENTS.includes(assignment) ? assignment : '',
    reviewState: review === 'NEW' || review === 'SEEN' || review === 'REVIEWED' || review === 'REVIEW_LATER' ? review : '',
    alertsOnly: params.get('alerts') === '1',
    metricsMissing: params.get('metrics') === 'missing',
    today: params.get('today') === '1',
    q: params.get('q') ?? '',
  };
}

/** The address form of the wall's filters (the inverse of filtersFromUrl). */
function filtersToQuery(f: WallFilters): Record<string, string | null> {
  return {
    brandId: f.brandId || null,
    campaignId: f.campaignId || null,
    influencerId: f.influencerId || null,
    platform: f.platform || null,
    status: f.status || null,
    assignment: f.assignment || null,
    reviewState: f.reviewState || null,
    alerts: f.alertsOnly ? '1' : null,
    metrics: f.metricsMissing ? 'missing' : null,
    today: f.today ? '1' : null,
    q: f.q || null,
  };
}

function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

function chipFromFilters(f: WallFilters): ChipKey {
  if (f.reviewState === 'NEW') return 'new';
  if (f.reviewState === 'SEEN') return 'seen';
  if (f.reviewState === 'REVIEWED') return 'reviewed';
  if (f.reviewState === 'REVIEW_LATER') return 'reviewLater';
  if (f.assignment === 'UNASSIGNED') return 'unassigned';
  if (f.alertsOnly) return 'alerts';
  if (f.metricsMissing) return 'noMetrics';
  if (f.today) return 'today';
  return 'all';
}

/**
 * The Live Content Command Center: Timeline (day → brand, item 10) is the
 * default operational view; Grid/Masonry/Feed remain for people who prefer
 * them. Filters and the page number live in the address (so a reload, a
 * shared link or the back button lands on the same view), and the first
 * page is server-rendered so the wall paints instantly. Chip counts and the daily summary come from ONE
 * GET /content/summary call, never one request per statistic.
 */
export function ContentWall({
  initial,
  brands,
  initialLayout,
}: {
  initial: CursorPage<PublishedContentDTO>;
  brands: BrandSummaryDTO[];
  initialLayout?: string | null;
}) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const searchParams = useSearchParams();
  const [filters, setFilters] = React.useState<WallFilters>(() => filtersFromUrl(searchParams));
  const [searchInput, setSearchInput] = React.useState(() => searchParams?.get('q') ?? '');
  const replaceQuery = useReplaceQuery();
  const [page, setPage] = useUrlPage();
  const [layout, setLayoutState] = React.useState<Layout>(
    initialLayout && (VALID_LAYOUTS as string[]).includes(initialLayout) ? (initialLayout as Layout) : 'timeline',
  );

  function setLayout(next: Layout) {
    setLayoutState(next);
    api.auth.updatePreferences({ contentLayout: next }).catch(() => undefined);
  }

  // Debounce free-text search into the active filter set that drives the query.
  React.useEffect(() => {
    const handle = setTimeout(() => {
      const q = searchInput.trim();
      setFilters((f) => (f.q === q ? f : { ...f, q }));
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const hasActiveFilters = Boolean(
    filters.brandId ||
      filters.campaignId ||
      filters.influencerId ||
      filters.platform ||
      filters.status ||
      filters.assignment ||
      filters.reviewState ||
      filters.alertsOnly ||
      filters.metricsMissing ||
      filters.today ||
      filters.q,
  );
  const isDefaultFilters = !hasActiveFilters;

  // Keep the address in step with the filters; a new filter starts again at page 1.
  const filtersKey = JSON.stringify(filters);
  const syncedFilters = React.useRef(filtersKey);
  React.useEffect(() => {
    if (syncedFilters.current === filtersKey) return;
    syncedFilters.current = filtersKey;
    replaceQuery({ ...filtersToQuery(filters), page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized filters
  }, [filtersKey]);

  function goToPage(next: number) {
    setPage(next);
    wallTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const wallTop = React.useRef<HTMLDivElement>(null);

  const { start: todayStart, end: todayEnd } = React.useMemo(() => todayBounds(), []);

  const summary = useQuery({
    queryKey: ['content-summary', todayStart.toISOString()] as const,
    queryFn: () => api.content.summary({ todayStart: todayStart.toISOString(), todayEnd: todayEnd.toISOString() }),
    staleTime: 30_000,
  });

  const query = useQuery({
    queryKey: ['content-feed', filters, page] as const,
    queryFn: () =>
      api.content.feed({
        page,
        limit: WALL_PAGE_SIZE,
        brandId: filters.brandId || undefined,
        campaignId: filters.campaignId || undefined,
        influencerId: filters.influencerId || undefined,
        platform: filters.platform || undefined,
        status: filters.status || undefined,
        assignment: filters.assignment || undefined,
        reviewState: filters.reviewState || undefined,
        alertsOnly: filters.alertsOnly || undefined,
        metrics: filters.metricsMissing ? ('missing' as const) : undefined,
        from: filters.today ? todayStart.toISOString() : undefined,
        to: filters.today ? todayEnd.toISOString() : undefined,
        q: filters.q || undefined,
      }),
    initialData: isDefaultFilters && page === 1 ? initial : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    // The Live Content wall reflects worker-detected availability/status changes,
    // so refresh it periodically while it's open (paused when the tab is hidden).
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const items = React.useMemo(() => query.data?.data ?? [], [query.data]);

  // New-content-arrival (item 49): a background refetch lands new pages
  // straight into the query cache, so `items` above already carries them —
  // without the anchor below, the Timeline/Grid would silently reorder under
  // a person mid-read the instant the 60s poll resolves, and the "Show new
  // content" banner would be lying about gating anything. `frozenTopId` is
  // the id of the leading item the person has actually consented to see;
  // everything the live feed now has ahead of it is held back (sliced off)
  // until they click through. We only ever advance the anchor — on first
  // load, on click, or when it's no longer present in the live data at all
  // (e.g. the filters changed to a different view) — never on a same-view
  // background refetch, which is the one case this exists to freeze.
  const [frozenTopId, setFrozenTopId] = React.useState<string | null>(null);
  // Picking a new filter set is a deliberate view change, not a background
  // arrival — never gate it behind the banner. Resetting the anchor during
  // render (React's documented pattern for "adjust state when a prop
  // changes") lands before paint, so there's no stale-frame flash before the
  // effect below would otherwise catch up.
  const [anchorFilters, setAnchorFilters] = React.useState(filters);
  if (filters !== anchorFilters) {
    setAnchorFilters(filters);
    setFrozenTopId(null);
  }
  React.useEffect(() => {
    if (query.isFetching) return;
    const newTop = items[0];
    if (!newTop) return;
    const stillPresent = frozenTopId != null && items.some((item) => item.id === frozenTopId);
    if (!stillPresent) setFrozenTopId(newTop.id);
  }, [items, query.isFetching, frozenTopId]);

  // Assumes the feed stays time-ordered (newest first) so only genuinely new
  // items can land ahead of the anchor — an unrelated resort could in theory
  // fool this count, but that's out of scope for this fix.
  // Only the first page can have new posts arrive at its top.
  const anchorIndex = page === 1 && frozenTopId ? items.findIndex((item) => item.id === frozenTopId) : -1;
  const pendingNewCount = anchorIndex > 0 ? anchorIndex : 0;
  const displayItems = pendingNewCount > 0 ? items.slice(anchorIndex) : items;

  function showNewContent() {
    setFrozenTopId(items[0]?.id ?? null);
  }

  React.useEffect(() => {
    if (query.error) {
      toast.error(query.error instanceof ApiError ? query.error.message : t('feed.loadError'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.error]);

  function resetFilters() {
    setSearchInput('');
    setFilters(EMPTY_FILTERS);
  }

  function selectChip(chip: ChipKey) {
    setFilters((f) => {
      const base: WallFilters = {
        ...f,
        reviewState: '',
        assignment: f.assignment === 'UNASSIGNED' ? '' : f.assignment,
        alertsOnly: false,
        metricsMissing: false,
        today: false,
      };
      switch (chip) {
        case 'new':
          return { ...base, reviewState: 'NEW' };
        case 'seen':
          return { ...base, reviewState: 'SEEN' };
        case 'reviewed':
          return { ...base, reviewState: 'REVIEWED' };
        case 'reviewLater':
          return { ...base, reviewState: 'REVIEW_LATER' };
        case 'unassigned':
          return { ...base, assignment: 'UNASSIGNED', campaignId: '', influencerId: '' };
        case 'alerts':
          return { ...base, alertsOnly: true };
        case 'noMetrics':
          return { ...base, metricsMissing: true };
        case 'today':
          return { ...base, today: true };
        default:
          return base;
      }
    });
  }

  const isInitialLoading = query.isLoading && items.length === 0;

  return (
    <div className="space-y-6">
      <div ref={wallTop} className="-mt-6" aria-hidden />
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <ContentFilterChips
            active={chipFromFilters(filters)}
            counts={{
              new: summary.data?.new,
              seen: summary.data?.seen,
              reviewed: summary.data?.reviewed,
              reviewLater: summary.data?.reviewLater,
              unassigned: summary.data?.unassigned,
              alerts: summary.data?.alerts,
              noMetrics: summary.data?.missingMetrics,
              today: summary.data?.today.total,
            }}
            onSelect={selectChip}
          />
        </div>
        {/* Walk through what's new one post at a time — narrowed to the brand/campaign picked below. */}
        <ReviewNewContentButton
          brandId={filters.brandId || undefined}
          campaignId={filters.campaignId || undefined}
          count={filters.brandId || filters.campaignId ? undefined : summary.data?.new}
        />
      </div>

      {layout === 'timeline' && summary.data ? <DailySummaryStrip summary={summary.data} /> : null}

      <FilterBar
        brands={brands}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        filters={filters}
        onFilterChange={(patch) =>
          setFilters((f) => {
            // Assignment and campaign/influencer are mutually exclusive filters on
            // the same underlying columns — picking one clears the other so the
            // two selects never silently contradict each other.
            if ('assignment' in patch && patch.assignment) return { ...f, ...patch, campaignId: '', influencerId: '' };
            if (('campaignId' in patch || 'influencerId' in patch) && f.assignment) {
              return { ...f, ...patch, assignment: '' };
            }
            return { ...f, ...patch };
          })
        }
        onReset={resetFilters}
        hasActiveFilters={hasActiveFilters}
        layout={layout}
        onLayoutChange={setLayout}
        resultCount={query.data?.pagination?.total ?? displayItems.length}
      />

      {pendingNewCount > 0 ? (
        <div className="flex items-center justify-center">
          <Button variant="secondary" size="sm" onClick={showNewContent} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> {t('feed.newBanner', { count: pendingNewCount })}
          </Button>
        </div>
      ) : null}

      {isInitialLoading ? (
        <LoadingSkeleton layout={layout} />
      ) : displayItems.length === 0 ? (
        <EmptyState
          icon={PlaySquare}
          title={hasActiveFilters ? t('feed.emptyFilteredTitle') : t('feed.emptyTitle')}
          description={hasActiveFilters ? t('feed.emptyFilteredDescription') : t('feed.emptyDescription')}
          action={
            hasActiveFilters ? (
              <Button variant="outline" onClick={resetFilters}>
                {tCommon('clearFilters')}
              </Button>
            ) : undefined
          }
        />
      ) : layout === 'timeline' ? (
        <ContentTimeline items={displayItems} />
      ) : layout === 'brand' ? (
        <BrandOverview
          brands={summary.data?.brands ?? []}
          onOpenBrand={(brandId) => {
            setFilters((f) => ({ ...f, brandId }));
            setLayout('timeline');
          }}
        />
      ) : layout === 'grid' ? (
        <ContentGrid items={displayItems} />
      ) : layout === 'masonry' ? (
        <ContentMasonry items={displayItems} />
      ) : (
        <FeedLayout items={displayItems} />
      )}

      {displayItems.length > 0 && layout !== 'brand' ? (
        <PageFooter pagination={query.data?.pagination} onPageChange={goToPage} className="border-t border-border" />
      ) : null}
    </div>
  );
}

function DailySummaryStrip({ summary }: { summary: NonNullable<ReturnType<typeof useQuery<import('@influenceos/contracts').ContentSummaryDTO>>['data']> }) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const { today } = summary;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-card">
      <span className="flex items-center gap-1.5 font-semibold text-foreground">
        <CalendarDays className="h-4 w-4 text-brand" /> {tCommon('today')}
      </span>
      <SummaryStat label={t('feed.summary.content')} value={today.total} />
      <SummaryStat label={enumLabel(tEnums, 'contentReviewStatus', 'NEW')} value={today.new} />
      <SummaryStat label={enumLabel(tEnums, 'contentReviewStatus', 'SEEN')} value={today.seen} />
      <SummaryStat label={enumLabel(tEnums, 'contentReviewStatus', 'REVIEWED')} value={today.reviewed} />
      {today.alerts > 0 ? <SummaryStat label={t('feed.summary.alerts')} value={today.alerts} tone="danger" /> : null}
      <SummaryStat label={t('feed.summary.brandsActive')} value={today.brandsActive} />
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <span className={cn('text-muted-foreground', tone === 'danger' && 'text-danger')}>
      <span className={cn('font-semibold', tone === 'danger' ? 'text-danger' : 'text-foreground')}>{value}</span> {label}
    </span>
  );
}

function BrandOverview({
  brands,
  onOpenBrand,
}: {
  brands: import('@influenceos/contracts').BrandContentSummaryDTO[];
  onOpenBrand: (brandId: string) => void;
}) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const active = brands.filter((b) => b.today > 0 || b.new > 0).sort((a, b) => b.today - a.today || b.new - a.new);
  const quiet = brands.filter((b) => !(b.today > 0 || b.new > 0));

  if (brands.length === 0) {
    return (
      <EmptyState icon={Building2} title={t('feed.brandOverview.emptyTitle')} description={t('feed.brandOverview.emptyDescription')} />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[...active, ...quiet].map((brand) => (
        <button
          key={brand.brandId}
          type="button"
          onClick={() => onOpenBrand(brand.brandId)}
          className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-start shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop"
        >
          <div className="flex items-center gap-2.5">
            <span className="h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: brand.primaryColor }} aria-hidden />
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-muted text-xs font-semibold">
                {brand.brandName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <span className="truncate font-semibold text-foreground">
              <BidiText>{brand.brandName}</BidiText>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">{brand.today}</span> {tCommon('today')}
            </span>
            {brand.new > 0 ? (
              <span>
                <span className="font-semibold text-brand">{brand.new}</span>{' '}
                {enumLabel(tEnums, 'contentReviewStatus', 'NEW')}
              </span>
            ) : null}
            {brand.alerts > 0 ? (
              <span className="text-danger">
                <span className="font-semibold">{brand.alerts}</span> {t('feed.summary.alerts')}
              </span>
            ) : null}
          </div>
        </button>
      ))}
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
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
      {/* Search and layout share the top row and the filters get a row of their own — squeezed
          between the two, the filters used to stack one per line even on a wide screen. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1 md:max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t('feed.filterBar.searchPlaceholder')}
            aria-label={t('feed.filterBar.searchAriaLabel')}
            className="ps-9"
          />
        </div>
        <div className="md:ms-auto">
          <Tabs value={layout} onValueChange={(value) => onLayoutChange(value as Layout)}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="timeline" aria-label={t('feed.layouts.timelineAria')}>
                <CalendarDays className="h-4 w-4" /> {t('feed.layouts.timeline')}
              </TabsTrigger>
              <TabsTrigger value="brand" aria-label={t('feed.layouts.byBrandAria')}>
                <Building2 className="h-4 w-4" /> {t('feed.layouts.byBrand')}
              </TabsTrigger>
              <TabsTrigger value="grid" aria-label={t('feed.layouts.gridAria')}>
                <LayoutGrid className="h-4 w-4" /> {t('feed.layouts.grid')}
              </TabsTrigger>
              <TabsTrigger value="masonry" aria-label={t('feed.layouts.masonryAria')}>
                <LayoutPanelTop className="h-4 w-4" /> {t('feed.layouts.masonry')}
              </TabsTrigger>
              <TabsTrigger value="feed" aria-label={t('feed.layouts.feedAria')}>
                <Rows3 className="h-4 w-4" /> {t('feed.layouts.feed')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={filters.brandId || ALL} onValueChange={(value) => onFilterChange({ brandId: value === ALL ? '' : value })}>
          <SelectTrigger className="h-10 w-full sm:w-40">
            <SelectValue placeholder={t('feed.filterBar.brand')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tCommon('allBrands')}</SelectItem>
            {brands.map((brand) => (
              <SelectItem key={brand.id} value={brand.id}>
                {brand.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.platform || ALL} onValueChange={(value) => onFilterChange({ platform: value === ALL ? '' : value })}>
          <SelectTrigger className="h-10 w-full sm:w-40">
            <SelectValue placeholder={t('feed.filterBar.platform')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('feed.filterBar.allPlatforms')}</SelectItem>
            {PLATFORMS.map((platform) => (
              <SelectItem key={platform} value={platform}>
                {PLATFORM_META[platform].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.status || ALL} onValueChange={(value) => onFilterChange({ status: value === ALL ? '' : value })}>
          <SelectTrigger className="h-10 w-full sm:w-40">
            <SelectValue placeholder={tCommon('status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('feed.filterBar.allStatuses')}</SelectItem>
            {CONTENT_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {enumLabel(tEnums, 'contentStatus', status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <EntityCombobox
          kind="campaign"
          value={filters.campaignId}
          onChange={(id) => onFilterChange({ campaignId: id })}
          brandId={filters.brandId || undefined}
          placeholder={t('feed.filterBar.allCampaigns')}
          noneLabel={t('feed.filterBar.allCampaigns')}
          aria-label={t('feed.filterBar.campaign')}
          className="w-full sm:w-44"
        />

        <EntityCombobox
          kind="influencer"
          value={filters.influencerId}
          onChange={(id) => onFilterChange({ influencerId: id })}
          placeholder={t('feed.filterBar.allInfluencers')}
          noneLabel={t('feed.filterBar.allInfluencers')}
          aria-label={t('feed.filterBar.influencer')}
          className="w-full sm:w-44"
        />

        <Select
          value={filters.assignment || ALL}
          onValueChange={(value) =>
            onFilterChange({ assignment: value === ALL ? '' : (value as ContentAssociationStatus) })
          }
        >
          <SelectTrigger className="h-10 w-full sm:w-44">
            <SelectValue placeholder={t('feed.filterBar.assignment')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('feed.filterBar.allContent')}</SelectItem>
            {(Object.keys(CONTENT_ASSOCIATION_STATUS_LABELS) as ContentAssociationStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {enumLabel(tEnums, 'contentAssociationStatus', s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={onReset} className="text-muted-foreground">
            <X className="h-3.5 w-3.5" /> {t('feed.filterBar.reset')}
          </Button>
        ) : null}

        <span className="text-xs text-muted-foreground sm:ms-auto">
          {t('feed.filterBar.resultsLoaded', { count: resultCount })}
        </span>
      </div>

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
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const { relativeTime } = useLocalizedFormat();
  const m = content.metrics;

  return (
    <article className="overflow-hidden rounded-3xl border border-border bg-card shadow-card transition-shadow hover:shadow-pop">
      <div className="flex items-center gap-3 p-4">
        <Avatar name={content.influencer?.displayName ?? tCommon('unknown')} src={content.influencer?.avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          {content.influencer ? (
            <Link href={`/influencers/${content.influencer.id}`} className="truncate font-semibold hover:underline">
              <BidiText>{content.influencer.displayName}</BidiText>
            </Link>
          ) : (
            <p className="truncate font-semibold text-muted-foreground">
              {enumLabel(tEnums, 'contentAssociationStatus', 'UNASSIGNED')}
            </p>
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
          {!content.isStory ? (
            <a
              href={content.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {tCommon('openOriginal')} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
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
  const tCommon = useTranslations('common');
  return (
    <span className={cn('flex items-center gap-1.5', value == null && 'opacity-50')}>
      <Icon className="h-4 w-4" />
      {value == null ? tCommon('na') : <LtrText>{formatCompact(value)}</LtrText>}
    </span>
  );
}
