'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Filter, Package } from 'lucide-react';
import type { BrandSummaryDTO, LogisticsRequestDTO } from '@influenceos/contracts';
import {
  ADDRESS_HEALTH_LABELS,
  ADDRESS_HEALTH_TONE,
  COUNTRIES,
  DELIVERABLE_TYPE_LABELS,
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONE,
} from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { SavedViews } from '@/app/(app)/influencers/saved-views';
import { LogisticsCountryStrip } from './logistics-country-strip';
import { LogisticsChatPanel } from './logistics-chat-panel';
import { ShipmentDetailSheet } from './shipment-detail-sheet';
import { useApp } from '@/components/shell/app-context';
import { cn } from '@/lib/cn';

const ALL = 'all';

interface Filters {
  status: string;
  brandId: string;
  destinationCountryCode: string;
  influencerCountryCode: string;
  assigneeId: string;
  requesterId: string;
  // Not a UI filter chip — deep-linked only (e.g. the Influencer 360
  // "open logistics issue" banner links to /logistics?influencerId=…&hasOpenIssue=true).
  influencerId: string;
  courier: string;
  productName: string;
  dateFrom: string;
  dateTo: string;
  hasOpenIssue: string;
  needsAttention: string;
  // Not UI filter chips — deep-linked only, from the Data Quality Center's
  // active-shipment findings (e.g. /logistics?missingAddress=true).
  missingAddress: string;
  missingPhone: string;
  missingDestinationCountry: string;
}

const EMPTY_FILTERS: Filters = {
  status: '',
  brandId: '',
  destinationCountryCode: '',
  influencerCountryCode: '',
  assigneeId: '',
  requesterId: '',
  influencerId: '',
  courier: '',
  productName: '',
  dateFrom: '',
  dateTo: '',
  hasOpenIssue: '',
  needsAttention: '',
  missingAddress: '',
  missingPhone: '',
  missingDestinationCountry: '',
};

function readFilters(params: URLSearchParams): Filters {
  const f = { ...EMPTY_FILTERS };
  for (const key of Object.keys(f) as (keyof Filters)[]) {
    const v = params.get(key);
    if (v) f[key] = v;
  }
  return f;
}

export function LogisticsWorkspace({
  initial,
  brands,
}: {
  initial: { data: LogisticsRequestDTO[]; hasMore: boolean; nextCursor: string | null };
  brands: BrandSummaryDTO[];
}) {
  const { user } = useApp();
  // Initial filter values come from the URL so the Exec Brief's "shipments
  // delivered/failed" metrics, a Saved View, and Needs Attention can all
  // deep-link straight into a pre-filtered view.
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const [filters, setFilters] = React.useState<Filters>(() => readFilters(searchParams));
  React.useEffect(() => {
    setFilters(readFilters(new URLSearchParams(paramsKey)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const isDefault = Object.values(filters).every((v) => !v);

  const directory = useQuery({ queryKey: ['team-directory'], queryFn: () => api.users.directory(), staleTime: 60_000 });

  const set = (patch: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...patch }));

  const query = useInfiniteQuery({
    queryKey: ['logistics', filters] as const,
    queryFn: ({ pageParam }) => api.shipments.list({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    initialData: isDefault ? () => ({ pages: [initial], pageParams: [undefined] }) : undefined,
    staleTime: 15_000,
  });

  const rows = React.useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const quickView: 'all' | 'mine' | 'unassigned' | 'attention' =
    filters.needsAttention === 'true' ? 'attention' : filters.assigneeId === 'me' ? 'mine' : filters.assigneeId === 'unassigned' ? 'unassigned' : 'all';

  function applyQuickView(v: typeof quickView) {
    if (v === 'all') set({ assigneeId: '', needsAttention: '' });
    else if (v === 'mine') set({ assigneeId: 'me', needsAttention: '' });
    else if (v === 'unassigned') set({ assigneeId: 'unassigned', needsAttention: '' });
    else set({ assigneeId: '', needsAttention: 'true' });
  }

  const moreFilterCount = [
    filters.influencerCountryCode,
    filters.requesterId,
    filters.courier,
    filters.productName,
    filters.dateFrom,
    filters.dateTo,
    filters.hasOpenIssue,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <LogisticsCountryStrip
        filters={filters as unknown as Record<string, string | undefined>}
        selected={filters.destinationCountryCode}
        onSelect={(code) => set({ destinationCountryCode: code })}
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['all', 'All'],
              ['mine', 'My Queue'],
              ['unassigned', 'Unassigned'],
              ['attention', 'Needs Attention'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => applyQuickView(v)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                quickView === v ? 'border-brand bg-brand-soft text-brand' : 'border-border bg-surface hover:bg-surface-muted',
              )}
            >
              {label}
            </button>
          ))}
          <div className="sm:ms-auto flex items-center gap-2">
            <SavedViews scope="logistics" basePath="/logistics" current={filters as unknown as Record<string, string>} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select value={filters.status || ALL} onValueChange={(v) => set({ status: v === ALL ? '' : v })}>
            <SelectTrigger className="h-10 w-full sm:w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {SHIPMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SHIPMENT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.brandId || ALL} onValueChange={(v) => set({ brandId: v === ALL ? '' : v })}>
            <SelectTrigger className="h-10 w-full sm:w-44">
              <SelectValue placeholder="Brand" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All brands</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.assigneeId && filters.assigneeId !== 'me' && filters.assigneeId !== 'unassigned' ? filters.assigneeId : ALL} onValueChange={(v) => set({ assigneeId: v === ALL ? '' : v })}>
            <SelectTrigger className="h-10 w-full sm:w-48">
              <SelectValue placeholder="Assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any assignee</SelectItem>
              {(directory.data ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.id === user.id ? `${d.name} (me)` : d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-1.5">
                <Filter className="h-3.5 w-3.5" /> More filters
                {moreFilterCount > 0 && <span className="text-xs text-muted-foreground">({moreFilterCount})</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 space-y-3" align="start">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Creator country</label>
                <Select value={filters.influencerCountryCode || ALL} onValueChange={(v) => set({ influencerCountryCode: v === ALL ? '' : v })}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={ALL}>Any</SelectItem>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Requester</label>
                <Select value={filters.requesterId || ALL} onValueChange={(v) => set({ requesterId: v === ALL ? '' : v })}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Any</SelectItem>
                    {(directory.data ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Courier</label>
                <SearchInput className="mt-1" placeholder="e.g. DHL" value={filters.courier} onChange={(e) => set({ courier: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Product</label>
                <SearchInput className="mt-1" placeholder="e.g. Serum" value={filters.productName} onChange={(e) => set({ productName: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">From</label>
                  <input
                    type="date"
                    className="mt-1 flex h-9 w-full rounded-lg border border-input bg-surface px-2 text-sm shadow-soft"
                    value={filters.dateFrom}
                    onChange={(e) => set({ dateFrom: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">To</label>
                  <input
                    type="date"
                    className="mt-1 flex h-9 w-full rounded-lg border border-input bg-surface px-2 text-sm shadow-soft"
                    value={filters.dateTo}
                    onChange={(e) => set({ dateTo: e.target.value })}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 pt-1 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer rounded border-border accent-brand"
                  checked={filters.hasOpenIssue === 'true'}
                  onChange={(e) => set({ hasOpenIssue: e.target.checked ? 'true' : '' })}
                />
                Address issue only
              </label>
              <div className="flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Clear all filters
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <span className="text-xs text-muted-foreground sm:ms-auto">{rows.length} loaded</span>
        </div>
      </div>

      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No shipments"
          description="Logistics requests created from any campaign's Shipments tab will appear here."
        />
      ) : (
        <div className="flex items-start gap-4">
          <Card className="min-w-0 flex-1 overflow-hidden">
            <TableScroll>
              <Table className="min-w-[1180px]">
                <TableHead>
                  <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                    <TableHeaderCell className="ps-5">Creator</TableHeaderCell>
                    <TableHeaderCell>Brand / Campaign</TableHeaderCell>
                    <TableHeaderCell>Deliverable</TableHeaderCell>
                    <TableHeaderCell>Destination</TableHeaderCell>
                    <TableHeaderCell>Address Health</TableHeaderCell>
                    <TableHeaderCell>Assignee</TableHeaderCell>
                    <TableHeaderCell>Courier / Tracking</TableHeaderCell>
                    <TableHeaderCell align="end" className="pe-5">
                      Status
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer" onClick={() => setSelectedId(s.id)}>
                      <TableCell className="ps-5">
                        {s.influencer ? (
                          <span className="flex items-center gap-2.5">
                            <Avatar name={s.influencer.displayName} src={s.influencer.avatarUrl} size="xs" />
                            <span className="truncate font-medium">{s.influencer.displayName}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-muted-foreground">
                        {s.brand ? `${s.brand.name} · ${s.campaign?.name}` : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.deliverableType ? DELIVERABLE_TYPE_LABELS[s.deliverableType] : '—'}
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate text-muted-foreground">
                        {[s.city, s.country].filter(Boolean).join(', ') || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge tone={ADDRESS_HEALTH_TONE[s.addressHealth]}>{ADDRESS_HEALTH_LABELS[s.addressHealth]}</Badge>
                        {s.openIssue && <span className="ms-1.5 text-xs text-danger">1 open</span>}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-muted-foreground">{s.assignedToName ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.courier ? `${s.courier} · ` : ''}
                        {s.trackingNumber ?? '—'}
                      </TableCell>
                      <TableCell align="end" className="pe-5">
                        <Badge tone={SHIPMENT_STATUS_TONE[s.status]}>{SHIPMENT_STATUS_LABELS[s.status]}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          </Card>
          <LogisticsChatPanel />
        </div>
      )}

      {rows.length > 0 && query.hasNextPage ? (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}

      <ShipmentDetailSheet shipment={selected} onOpenChange={(open) => !open && setSelectedId(null)} />
    </div>
  );
}
