'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileBarChart, Printer, X } from 'lucide-react';
import type { BrandSummaryDTO, ReportColumnDTO, ReportDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { dateTime, formatCurrency, formatNumber, formatPercent, shortDate } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { REPORT_TYPES, type ReportType } from './reports-types';

/** Sentinel value for Radix Select's "no filter" option (Select forbids an empty-string item value). */
const ALL = 'all';

export { REPORT_TYPES, type ReportType };

const REPORT_TABS: { value: ReportType; label: string }[] = [
  { value: 'campaign', label: 'Campaigns' },
  { value: 'influencer', label: 'Influencers' },
  { value: 'brand', label: 'Brands' },
  { value: 'content', label: 'Content' },
  { value: 'spend', label: 'Spend' },
];

interface FilterState {
  type: string;
  brandId: string;
  from: string;
  to: string;
}

export interface ReportsViewProps {
  initial: ReportDTO;
  brands: BrandSummaryDTO[];
  type: ReportType;
  brandId?: string;
  from?: string;
  to?: string;
}

/**
 * Reports & analytics workspace: a report-type switcher, brand + date-range
 * filters (all URL-driven so the server page re-fetches the report), a
 * dense data table with a totals row, and CSV export / print actions. The
 * server always supplies `initial` for the current filter combination, so
 * this component renders it directly rather than re-fetching client-side.
 */
export function ReportsView({ initial, brands, type, brandId, from, to }: ReportsViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  function navigate(next: Partial<FilterState>) {
    const merged: FilterState = {
      type: next.type !== undefined ? next.type : type,
      brandId: next.brandId !== undefined ? next.brandId : (brandId ?? ''),
      from: next.from !== undefined ? next.from : (from ?? ''),
      to: next.to !== undefined ? next.to : (to ?? ''),
    };
    const params = new URLSearchParams();
    if (merged.type && merged.type !== 'campaign') params.set('type', merged.type);
    if (merged.brandId) params.set('brandId', merged.brandId);
    if (merged.from) params.set('from', merged.from);
    if (merged.to) params.set('to', merged.to);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/reports?${qs}` : '/reports'));
  }

  const hasFilters = Boolean(brandId || from || to);
  const csvHref = api.reports.csvUrl({ type, brandId, from, to });
  const brandLabel = brandId ? (brands.find((b) => b.id === brandId)?.name ?? 'Selected brand') : 'All brands';
  const rangeLabel = from || to ? `${from ? shortDate(from) : 'Start'} – ${to ? shortDate(to) : 'Now'}` : 'All time';
  const reportLabel = REPORT_TABS.find((t) => t.value === type)?.label ?? type;

  return (
    <div className="space-y-6">
      {/* Print-only header: the on-screen tabs/filters are hidden when printing. */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">{reportLabel} report</h1>
        <p className="text-sm text-muted-foreground">
          {brandLabel} · {rangeLabel} · Generated {dateTime(new Date())}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Tabs value={type} onValueChange={(value) => navigate({ type: value })}>
          <TabsList>
            {REPORT_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} disabled={isPending}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button asChild>
            <a href={csvHref}>
              <Download className="h-4 w-4" /> Export CSV
            </a>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card print:hidden sm:flex-row sm:items-center">
        <Select
          value={brandId || ALL}
          onValueChange={(value) => navigate({ brandId: value === ALL ? '' : value })}
        >
          <SelectTrigger className="h-10 w-full sm:w-52" disabled={isPending}>
            <SelectValue placeholder="All brands" />
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

        <div className="flex flex-1 flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            From
            <Input
              type="date"
              value={from ?? ''}
              max={to || undefined}
              disabled={isPending}
              onChange={(event) => navigate({ from: event.target.value })}
              className="w-40"
              aria-label="From date"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            To
            <Input
              type="date"
              value={to ?? ''}
              min={from || undefined}
              disabled={isPending}
              onChange={(event) => navigate({ to: event.target.value })}
              className="w-40"
              aria-label="To date"
            />
          </label>

          {hasFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => navigate({ brandId: '', from: '', to: '' })}
              className="text-muted-foreground sm:ml-auto"
            >
              <X className="h-3.5 w-3.5" /> Reset
            </Button>
          ) : null}

          {isPending ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner className="h-3.5 w-3.5" /> Updating…
            </span>
          ) : null}
        </div>
      </div>

      <ReportTable report={initial} isPending={isPending} />
    </div>
  );
}

function isNumericColumn(colType: ReportColumnDTO['type']): boolean {
  return colType === 'number' || colType === 'currency' || colType === 'percent';
}

function formatCell(value: string | number | null, colType: ReportColumnDTO['type'], currency: string): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  switch (colType) {
    case 'currency':
      return Number.isFinite(n) ? formatCurrency(n, currency) : '—';
    case 'percent':
      return Number.isFinite(n) ? formatPercent(n) : '—';
    case 'number':
      return Number.isFinite(n) ? formatNumber(n) : '—';
    case 'date':
      return shortDate(String(value));
    default:
      return String(value);
  }
}

function ReportTable({ report, isPending }: { report: ReportDTO; isPending: boolean }) {
  if (report.rows.length === 0) {
    return (
      <EmptyState
        icon={FileBarChart}
        title="No data for this report"
        description="Try widening the date range or clearing the brand filter — data will appear here as soon as it's available."
      />
    );
  }

  return (
    <Card className={cn('overflow-hidden transition-opacity print:border-0 print:shadow-none', isPending && 'opacity-60')}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3 print:hidden">
        <p className="text-sm text-muted-foreground">
          {report.rows.length} row{report.rows.length === 1 ? '' : 's'} · {report.currency}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted/60">
              {report.columns.map((col, i) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                    isNumericColumn(col.type) ? 'text-right' : 'text-left',
                    i === 0 && 'pl-5',
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row, ri) => (
              <tr key={ri} className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-muted/40">
                {report.columns.map((col, i) => (
                  <td
                    key={col.key}
                    className={cn(
                      'whitespace-nowrap px-4 py-3 text-foreground',
                      isNumericColumn(col.type) ? 'text-right tabular-nums' : 'text-left',
                      i === 0 && 'pl-5 font-medium',
                    )}
                  >
                    {formatCell(row[col.key] ?? null, col.type, report.currency)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {report.totals ? (
            <tfoot>
              <tr className="border-t-2 border-border bg-surface-muted/60 font-semibold">
                {report.columns.map((col, i) => (
                  <td
                    key={col.key}
                    className={cn(
                      'whitespace-nowrap px-4 py-3',
                      isNumericColumn(col.type) ? 'text-right tabular-nums' : 'text-left',
                      i === 0 && 'pl-5',
                    )}
                  >
                    {i === 0 ? 'Total' : formatCell(report.totals?.[col.key] ?? null, col.type, report.currency)}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </Card>
  );
}
