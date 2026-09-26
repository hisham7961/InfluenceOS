'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { BrandSummaryDTO, ReportPeriod } from '@influenceos/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Spinner } from '@/components/ui/spinner';
import { BidiText } from '@/components/common/bidi-text';

const ALL = 'all';
const PERIODS: ReportPeriod[] = ['month', 'quarter', 'year', 'last30', 'custom'];

interface State {
  period: ReportPeriod;
  brandId: string;
  from: string;
  to: string;
}

/**
 * Period and brand for the owner's dashboard (P2.7). Everything lives in the
 * URL so the server page re-computes and the view can be bookmarked or sent.
 *
 * Changing them loads the page afresh rather than a client-side transition:
 * a search-param-only soft navigation of this large page was seen to stall
 * in the app router (Next 15.5, like the client report's toolbar).
 */
export function ExecControls({
  brands,
  period,
  brandId,
  from,
  to,
}: {
  brands: BrandSummaryDTO[];
  period: ReportPeriod;
  brandId?: string;
  from: string;
  to: string;
}) {
  const t = useTranslations('reports');
  const tCommon = useTranslations('common');
  const [isPending, setPending] = React.useState(false);
  const [range, setRange] = React.useState({ from, to });
  // Coming back with the browser's back button can restore this page as it was left.
  React.useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  function navigate(next: Partial<State>) {
    const s: State = { period, brandId: brandId ?? '', from, to, ...next };
    const params = new URLSearchParams();
    if (s.period !== 'month') params.set('period', s.period);
    if (s.brandId) params.set('brandId', s.brandId);
    if (s.period === 'custom') {
      if (s.from) params.set('from', s.from);
      if (s.to) params.set('to', s.to);
    }
    const qs = params.toString();
    setPending(true);
    window.location.assign(qs ? `/exec?${qs}` : '/exec');
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card print:hidden lg:flex-row lg:flex-wrap lg:items-center">
      <Tabs
        value={period}
        onValueChange={(v) => navigate({ period: v as ReportPeriod })}
        // Arrow keys move between tabs; Enter picks one (each pick loads the page).
        activationMode="manual"
        className="max-w-full"
      >
        <TabsList className="flex-wrap">
          {PERIODS.map((p) => (
            <TabsTrigger key={p} value={p} disabled={isPending}>
              {t(`exec.period.options.${p}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {period === 'custom' ? (
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (range.from && range.to) navigate({ from: range.from, to: range.to });
          }}
        >
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('fromLabel')}
            <Input
              type="date"
              value={range.from}
              max={range.to || undefined}
              disabled={isPending}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="w-40"
              aria-label={t('fromDateAria')}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('toLabel')}
            <Input
              type="date"
              value={range.to}
              min={range.from || undefined}
              disabled={isPending}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="w-40"
              aria-label={t('toDateAria')}
            />
          </label>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={isPending || !range.from || !range.to || (range.from === from && range.to === to)}
          >
            {t('exec.period.apply')}
          </Button>
        </form>
      ) : null}

      <div className="flex items-center gap-3 lg:ms-auto">
        {isPending ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner className="h-3.5 w-3.5" /> {t('updating')}
          </span>
        ) : null}
        {brands.length > 1 ? (
          <Select value={brandId || ALL} onValueChange={(v) => navigate({ brandId: v === ALL ? '' : v })}>
            <SelectTrigger className="h-10 w-full sm:w-52" disabled={isPending} aria-label={tCommon('brand')}>
              <SelectValue placeholder={tCommon('allBrands')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{tCommon('allBrands')}</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  <BidiText>{b.name}</BidiText>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  );
}
