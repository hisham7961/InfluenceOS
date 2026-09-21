'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Download, FileBarChart, Printer, X } from 'lucide-react';
import type { BrandSummaryDTO, ReportColumnDTO, ReportDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { dateTime, formatCurrency, formatNumber, formatPercent, shortDate } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { BidiText } from '@/components/common/bidi-text';
import { REPORT_TYPES, type ReportType } from './reports-types';

/** Sentinel value for Radix Select's "no filter" option (Select forbids an empty-string item value). */
const ALL = 'all';

export { REPORT_TYPES, type ReportType };

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
const REPORT_TAB_ORDER: ReportType[] = ['campaign', 'influencer', 'brand', 'content', 'spend'];

export function ReportsView({ initial, brands, type, brandId, from, to }: ReportsViewProps) {
  const t = useTranslations('reports');
  const tCommon = useTranslations('common');
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
  const brandLabel = brandId ? (brands.find((b) => b.id === brandId)?.name ?? t('selectedBrandFallback')) : tCommon('allBrands');
  const rangeLabel = from || to ? `${from ? shortDate(from) : t('rangeStart')} – ${to ? shortDate(to) : t('rangeNow')}` : t('rangeAllTime');
  const reportLabel = t(`tabs.${type}`);

  return (
    <div className="space-y-6">
      {/* Print-only header: the on-screen tabs/filters are hidden when printing. */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">{t('printTitle', { report: reportLabel })}</h1>
        <p className="text-sm text-muted-foreground">
          {t('printSubtitle', {
            brand: brandLabel,
            range: rangeLabel,
            generated: t('printGeneratedAt', { time: dateTime(new Date()) }),
          })}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Tabs value={type} onValueChange={(value) => navigate({ type: value })}>
          <TabsList>
            {REPORT_TAB_ORDER.map((value) => (
              <TabsTrigger key={value} value={value} disabled={isPending}>
                {t(`tabs.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> {t('print')}
          </Button>
          <Button asChild>
            <a href={csvHref}>
              <Download className="h-4 w-4" /> {t('exportCsv')}
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
            <SelectValue placeholder={tCommon('allBrands')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tCommon('allBrands')}</SelectItem>
            {brands.map((brand) => (
              <SelectItem key={brand.id} value={brand.id}>
                <BidiText>{brand.name}</BidiText>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-1 flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('fromLabel')}
            <Input
              type="date"
              value={from ?? ''}
              max={to || undefined}
              disabled={isPending}
              onChange={(event) => navigate({ from: event.target.value })}
              className="w-40"
              aria-label={t('fromDateAria')}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('toLabel')}
            <Input
              type="date"
              value={to ?? ''}
              min={from || undefined}
              disabled={isPending}
              onChange={(event) => navigate({ to: event.target.value })}
              className="w-40"
              aria-label={t('toDateAria')}
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
              <X className="h-3.5 w-3.5" /> {t('reset')}
            </Button>
          ) : null}

          {isPending ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner className="h-3.5 w-3.5" /> {t('updating')}
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
  const t = useTranslations('reports');

  if (report.rows.length === 0) {
    return <EmptyState icon={FileBarChart} title={t('table.emptyTitle')} description={t('table.emptyDescription')} />;
  }

  return (
    <Card className={cn('overflow-hidden transition-opacity print:border-0 print:shadow-none', isPending && 'opacity-60')}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3 print:hidden">
        <p className="text-sm text-muted-foreground">{t('table.rowCount', { count: report.rows.length, currency: report.currency })}</p>
      </div>

      <TableScroll>
        <Table className="min-w-[640px]">
          <TableHead>
            <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
              {report.columns.map((col, i) => (
                <TableHeaderCell
                  key={col.key}
                  align={isNumericColumn(col.type) ? 'end' : 'start'}
                  className={cn(i === 0 && 'ps-5')}
                >
                  {col.label}
                </TableHeaderCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {report.rows.map((row, ri) => (
              <TableRow key={ri}>
                {report.columns.map((col, i) => {
                  const formatted = formatCell(row[col.key] ?? null, col.type, report.currency);
                  return (
                    <TableCell
                      key={col.key}
                      align={isNumericColumn(col.type) ? 'end' : 'start'}
                      className={cn(i === 0 && 'ps-5 font-medium')}
                    >
                      {/* String columns hold report data (creator/campaign/brand names, etc.) that may be Arabic, English or mixed — isolate their direction so they never scramble inside the RTL table. */}
                      {col.type === 'string' ? <BidiText>{formatted}</BidiText> : formatted}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
          {report.totals ? (
            <TableFooter>
              <TableRow className="border-t-2 border-border bg-surface-muted/60 font-semibold hover:bg-surface-muted/60">
                {report.columns.map((col, i) => (
                  <TableCell
                    key={col.key}
                    align={isNumericColumn(col.type) ? 'end' : 'start'}
                    className={cn(i === 0 && 'ps-5')}
                  >
                    {i === 0 ? t('table.total') : formatCell(report.totals?.[col.key] ?? null, col.type, report.currency)}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </TableScroll>
    </Card>
  );
}
