'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Filter, Package } from 'lucide-react';
import type { BrandSummaryDTO, CursorPage, LogisticsRequestDTO } from '@influenceos/contracts';
import {
  ADDRESS_HEALTH_TONE,
  COUNTRIES,
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_TONE,
} from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { useReplaceQuery, useUrlPage } from '@/lib/use-url-page';
import { PageFooter } from '@/components/ui/page-footer';
import { LOGISTICS_PAGE_SIZE } from './logistics-constants';
import { enumLabel } from '@/lib/enum-labels';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableScroll,
} from '@/components/ui/table';
import { SavedViews } from '@/app/(app)/influencers/saved-views';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { LogisticsCountryStrip } from './logistics-country-strip';
import { LogisticsChatPanel } from './logistics-chat-panel';
import { ShipmentDetailSheet } from './shipment-detail-sheet';
import { useApp } from '@/components/shell/app-context';
import { cn } from '@/lib/cn';
import { useIsPhone } from '@/lib/use-is-phone';

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
  initial: CursorPage<LogisticsRequestDTO>;
  brands: BrandSummaryDTO[];
}) {
  const isPhone = useIsPhone();
  const { user } = useApp();
  const t = useTranslations('logistics');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
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

  const directory = useQuery({
    queryKey: ['team-directory'],
    queryFn: () => api.users.directory(),
    staleTime: 60_000,
  });

  const set = (patch: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...patch }));

  // Filters and the page number live in the address; a new filter starts at page 1.
  const replaceQuery = useReplaceQuery();
  const [page, setPage] = useUrlPage();
  const filtersKey = JSON.stringify(filters);
  const syncedFilters = React.useRef(filtersKey);
  React.useEffect(() => {
    if (syncedFilters.current === filtersKey) return;
    syncedFilters.current = filtersKey;
    replaceQuery({ ...filters, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized filters
  }, [filtersKey]);

  const query = useQuery({
    queryKey: ['logistics', filters, page] as const,
    queryFn: () => api.shipments.list({ ...filters, page, limit: LOGISTICS_PAGE_SIZE }),
    initialData: isDefault && page === 1 ? initial : undefined,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const rows = React.useMemo(() => query.data?.data ?? [], [query.data]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const quickView: 'all' | 'mine' | 'unassigned' | 'attention' =
    filters.needsAttention === 'true'
      ? 'attention'
      : filters.assigneeId === 'me'
        ? 'mine'
        : filters.assigneeId === 'unassigned'
          ? 'unassigned'
          : 'all';

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

      <div className="border-border bg-card shadow-card flex flex-col gap-3 rounded-2xl border p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['all', t('workspace.quickView.all')],
              ['mine', t('workspace.quickView.mine')],
              ['unassigned', tc('unassigned')],
              ['attention', t('workspace.quickView.attention')],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => applyQuickView(v)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                quickView === v
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-border bg-surface hover:bg-surface-muted',
              )}
            >
              {label}
            </button>
          ))}
          <div className="flex items-center gap-2 sm:ms-auto">
            <SavedViews
              scope="logistics"
              basePath="/logistics"
              current={filters as unknown as Record<string, string>}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={filters.status || ALL}
            onValueChange={(v) => set({ status: v === ALL ? '' : v })}
          >
            <SelectTrigger className="h-10 w-full sm:w-44">
              <SelectValue placeholder={tc('status')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('workspace.allStatuses')}</SelectItem>
              {SHIPMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {enumLabel(te, 'shipmentStatus', s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.brandId || ALL}
            onValueChange={(v) => set({ brandId: v === ALL ? '' : v })}
          >
            <SelectTrigger className="h-10 w-full sm:w-44">
              <SelectValue placeholder={t('workspace.brandPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{tc('allBrands')}</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={
              filters.assigneeId &&
              filters.assigneeId !== 'me' &&
              filters.assigneeId !== 'unassigned'
                ? filters.assigneeId
                : ALL
            }
            onValueChange={(v) => set({ assigneeId: v === ALL ? '' : v })}
          >
            <SelectTrigger className="h-10 w-full sm:w-48">
              <SelectValue placeholder={t('workspace.assignee')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('workspace.anyAssignee')}</SelectItem>
              {(directory.data ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.id === user.id ? (
                    t('workspace.assigneeMe', { name: d.name })
                  ) : (
                    <BidiText>{d.name}</BidiText>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-1.5">
                <Filter className="h-3.5 w-3.5" /> {t('workspace.moreFilters')}
                {moreFilterCount > 0 && (
                  <span className="text-muted-foreground text-xs">({moreFilterCount})</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 space-y-3" align="start">
              <div>
                <label className="text-muted-foreground text-xs font-medium">
                  {t('workspace.creatorCountry')}
                </label>
                <Select
                  value={filters.influencerCountryCode || ALL}
                  onValueChange={(v) => set({ influencerCountryCode: v === ALL ? '' : v })}
                >
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue placeholder={t('workspace.any')} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={ALL}>{t('workspace.any')}</SelectItem>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-muted-foreground text-xs font-medium">
                  {t('workspace.requester')}
                </label>
                <Select
                  value={filters.requesterId || ALL}
                  onValueChange={(v) => set({ requesterId: v === ALL ? '' : v })}
                >
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue placeholder={t('workspace.any')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('workspace.any')}</SelectItem>
                    {(directory.data ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        <BidiText>{d.name}</BidiText>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-muted-foreground text-xs font-medium">
                  {t('form.courier')}
                </label>
                <SearchInput
                  className="mt-1"
                  placeholder={t('workspace.courierPlaceholder')}
                  value={filters.courier}
                  onChange={(e) => set({ courier: e.target.value })}
                />
              </div>
              <div>
                <label className="text-muted-foreground text-xs font-medium">
                  {t('workspace.product')}
                </label>
                <SearchInput
                  className="mt-1"
                  placeholder={t('workspace.productPlaceholder')}
                  value={filters.productName}
                  onChange={(e) => set({ productName: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-muted-foreground text-xs font-medium">
                    {t('workspace.dateFrom')}
                  </label>
                  <input
                    type="date"
                    className="border-input bg-surface shadow-soft mt-1 flex h-9 w-full rounded-lg border px-2 text-sm"
                    value={filters.dateFrom}
                    onChange={(e) => set({ dateFrom: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-muted-foreground text-xs font-medium">
                    {t('workspace.dateTo')}
                  </label>
                  <input
                    type="date"
                    className="border-input bg-surface shadow-soft mt-1 flex h-9 w-full rounded-lg border px-2 text-sm"
                    value={filters.dateTo}
                    onChange={(e) => set({ dateTo: e.target.value })}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 pt-1 text-sm">
                <input
                  type="checkbox"
                  className="border-border accent-brand h-4 w-4 cursor-pointer rounded"
                  checked={filters.hasOpenIssue === 'true'}
                  onChange={(e) => set({ hasOpenIssue: e.target.checked ? 'true' : '' })}
                />
                {t('workspace.addressIssueOnly')}
              </label>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                >
                  {t('workspace.clearAllFilters')}
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <span className="text-muted-foreground text-xs sm:ms-auto">
            {t('workspace.loadedCount', { count: rows.length })}
          </span>
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
          title={t('workspace.emptyTitle')}
          description={t('workspace.emptyDescription')}
        />
      ) : (
        <div className="flex flex-col-reverse gap-3 lg:flex-row lg:items-start lg:gap-4">
          {/* Phones: one tappable card per shipment (P3.6); the wide table from sm up. */}
          {isPhone ? (
            <ul className="min-w-0 flex-1 space-y-2">
              {rows.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className="border-border bg-card shadow-card hover:bg-surface-muted/60 focus-visible:ring-ring w-full rounded-2xl border p-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2.5">
                        {s.influencer ? (
                          <>
                            <Avatar
                              name={s.influencer.displayName}
                              src={s.influencer.avatarUrl}
                              size="xs"
                            />
                            <BidiText as="span" className="min-w-0 truncate font-medium">
                              {s.influencer.displayName}
                            </BidiText>
                          </>
                        ) : (
                          <span className="text-muted-foreground">{tc('unassigned')}</span>
                        )}
                      </span>
                      <Badge tone={SHIPMENT_STATUS_TONE[s.status]}>
                        {enumLabel(te, 'shipmentStatus', s.status)}
                      </Badge>
                    </span>
                    <span className="text-muted-foreground mt-1 block truncate text-sm">
                      {s.brand ? `${s.brand.name} · ${s.campaign?.name}` : '—'}
                    </span>
                    <span className="text-muted-foreground mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge tone={ADDRESS_HEALTH_TONE[s.addressHealth]}>
                        {enumLabel(te, 'addressHealth', s.addressHealth)}
                      </Badge>
                      {s.openIssue ? (
                        <span className="text-danger">{t('workspace.oneOpenIssue')}</span>
                      ) : null}
                      <span>{[s.city, s.country].filter(Boolean).join(', ') || '—'}</span>
                      {s.trackingNumber ? (
                        <span>
                          · {s.courier ? `${s.courier} ` : ''}
                          <LtrText>{s.trackingNumber}</LtrText>
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Card className="min-w-0 flex-1 overflow-hidden">
              <TableScroll>
                <Table className="min-w-[1180px]">
                  <TableHead>
                    <TableRow className="border-border bg-surface-muted/60 hover:bg-surface-muted/60 border-b">
                      <TableHeaderCell className="ps-5">
                        {t('workspace.columns.creator')}
                      </TableHeaderCell>
                      <TableHeaderCell>{t('workspace.columns.brandCampaign')}</TableHeaderCell>
                      <TableHeaderCell>{t('workspace.columns.deliverable')}</TableHeaderCell>
                      <TableHeaderCell>{t('workspace.columns.destination')}</TableHeaderCell>
                      <TableHeaderCell>{t('workspace.columns.addressHealth')}</TableHeaderCell>
                      <TableHeaderCell>{t('workspace.assignee')}</TableHeaderCell>
                      <TableHeaderCell>{t('workspace.columns.courierTracking')}</TableHeaderCell>
                      <TableHeaderCell align="end" className="pe-5">
                        {tc('status')}
                      </TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((s) => (
                      <TableRow
                        key={s.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedId(s.id)}
                      >
                        <TableCell className="max-w-[180px] ps-5">
                          {s.influencer ? (
                            <span className="flex min-w-0 items-center gap-2.5">
                              <Avatar
                                name={s.influencer.displayName}
                                src={s.influencer.avatarUrl}
                                size="xs"
                              />
                              <BidiText as="span" className="min-w-0 truncate font-medium">
                                {s.influencer.displayName}
                              </BidiText>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{tc('unassigned')}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[180px] truncate">
                          {s.brand ? `${s.brand.name} · ${s.campaign?.name}` : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {s.deliverableType
                            ? enumLabel(te, 'deliverableType', s.deliverableType)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[160px] truncate">
                          {[s.city, s.country].filter(Boolean).join(', ') || '—'}
                        </TableCell>
                        <TableCell>
                          <Badge tone={ADDRESS_HEALTH_TONE[s.addressHealth]}>
                            {enumLabel(te, 'addressHealth', s.addressHealth)}
                          </Badge>
                          {s.openIssue && (
                            <span className="text-danger ms-1.5 text-xs">
                              {t('workspace.oneOpenIssue')}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[140px] truncate">
                          {s.assignedToName ? <BidiText>{s.assignedToName}</BidiText> : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {s.courier ? `${s.courier} · ` : ''}
                          {s.trackingNumber ? <LtrText>{s.trackingNumber}</LtrText> : '—'}
                        </TableCell>
                        <TableCell align="end" className="pe-5">
                          <Badge tone={SHIPMENT_STATUS_TONE[s.status]}>
                            {enumLabel(te, 'shipmentStatus', s.status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScroll>
            </Card>
          )}
          <LogisticsChatPanel />
        </div>
      )}

      {rows.length > 0 ? (
        <PageFooter pagination={query.data?.pagination} onPageChange={setPage} />
      ) : null}

      <ShipmentDetailSheet
        shipment={selected}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </div>
  );
}
