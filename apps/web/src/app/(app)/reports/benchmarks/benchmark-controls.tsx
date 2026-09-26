'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { BENCHMARK_MONTHS, FOLLOWER_TIERS, PLATFORMS, PLATFORM_META } from '@influenceos/shared';
import { enumLabel } from '@/lib/enum-labels';
import { GULF_COUNTRY_CODES, useCountryName, useSortedCountries } from '@/lib/country-names';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';

const ANY = 'any';

export interface BenchmarkControlsState {
  currency: string;
  months: number;
  countryCode: string;
  platform: string;
  tier: string;
}

/**
 * Currency, period, creator country and the platform × size to focus on
 * (P3.7). All in the address, so a view can be bookmarked or sent; each change
 * loads the page afresh (see ExecControls for why).
 */
export function BenchmarkControls({
  state,
  currencies,
}: {
  state: BenchmarkControlsState;
  currencies: string[];
}) {
  const t = useTranslations('reports.benchmarks.controls');
  const te = useTranslations('enums');
  const countryName = useCountryName();
  const countries = useSortedCountries();
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  function navigate(patch: Partial<BenchmarkControlsState>) {
    const s = { ...state, ...patch };
    const params = new URLSearchParams();
    if (s.currency !== 'KWD') params.set('currency', s.currency);
    if (s.months !== 12) params.set('months', String(s.months));
    if (s.countryCode) params.set('countryCode', s.countryCode);
    if (s.platform) params.set('platform', s.platform);
    if (s.tier) params.set('tier', s.tier);
    const qs = params.toString();
    setPending(true);
    window.location.assign(qs ? `/reports/benchmarks?${qs}` : '/reports/benchmarks');
  }

  const gulf = GULF_COUNTRY_CODES as readonly string[];
  const field = (label: string, control: React.ReactNode) => (
    <div className="min-w-0 space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      {control}
    </div>
  );

  return (
    <div className="border-border bg-card shadow-card grid grid-cols-2 gap-3 rounded-2xl border p-4 sm:grid-cols-3 lg:grid-cols-5">
      {field(
        t('currency'),
        <Select
          value={state.currency}
          onValueChange={(v) => navigate({ currency: v })}
          disabled={pending}
        >
          <SelectTrigger aria-label={t('currency')} dir="ltr">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currencies.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
      )}
      {field(
        t('period'),
        <Select
          value={String(state.months)}
          onValueChange={(v) => navigate({ months: Number(v) })}
          disabled={pending}
        >
          <SelectTrigger aria-label={t('period')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BENCHMARK_MONTHS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {t(`months.${m}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
      )}
      {field(
        t('country'),
        <Select
          value={state.countryCode || ANY}
          onValueChange={(v) => navigate({ countryCode: v === ANY ? '' : v })}
          disabled={pending}
        >
          <SelectTrigger aria-label={t('country')}>
            <SelectValue>
              {state.countryCode ? countryName(state.countryCode) : t('anyCountry')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ANY}>{t('anyCountry')}</SelectItem>
            {gulf.map((c) => (
              <SelectItem key={c} value={c}>
                {countryName(c)}
              </SelectItem>
            ))}
            <SelectSeparator />
            {countries
              .filter((c) => !gulf.includes(c.code))
              .map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>,
      )}
      {field(
        t('platform'),
        <Select
          value={state.platform || ANY}
          onValueChange={(v) => navigate({ platform: v === ANY ? '' : v })}
          disabled={pending}
        >
          <SelectTrigger aria-label={t('platform')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t('anyPlatform')}</SelectItem>
            {PLATFORMS.map((p) => (
              <SelectItem key={p} value={p}>
                {PLATFORM_META[p].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
      )}
      {field(
        t('tier'),
        <div className="flex items-center gap-2">
          <Select
            value={state.tier || ANY}
            onValueChange={(v) => navigate({ tier: v === ANY ? '' : v })}
            disabled={pending}
          >
            <SelectTrigger aria-label={t('tier')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('anyTier')}</SelectItem>
              {FOLLOWER_TIERS.map((tier) => (
                <SelectItem key={tier} value={tier}>
                  {enumLabel(te, 'followerTier', tier)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {pending ? <Spinner className="h-4 w-4 shrink-0" /> : null}
        </div>,
      )}
    </div>
  );
}
