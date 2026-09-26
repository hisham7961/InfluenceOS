'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { SlidersHorizontal } from 'lucide-react';
import { CREATOR_GENDERS, CREATOR_LANGUAGES, countryName } from '@influenceos/shared';
import { enumLabel } from '@/lib/enum-labels';
import { GULF_COUNTRY_CODES, useCountryName, useSortedCountries } from '@/lib/country-names';
import { useListParams, type ActiveFilter } from '@/components/common/list-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ANY = 'any';
const AUDIENCE_SHARES = [10, 25, 40, 50, 60, 75] as const;
const ENGAGEMENT_FLOORS = [1, 2, 3, 5] as const;

/** URL params these filters drive (P3.7). */
export const MORE_FILTER_KEYS = [
  'audienceCountry',
  'audienceMinPct',
  'minEngagementRate',
  'language',
  'gender',
  'minRate',
  'maxRate',
  'rateCurrency',
] as const;

/** A language code's name in the viewer's language ("Arabic" / "العربية"). */
export function useLanguageName() {
  const locale = useLocale();
  return React.useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([locale], { type: 'language' });
    } catch {
      names = null;
    }
    return (code: string) => names?.of(code) ?? code;
  }, [locale]);
}

/** Chips for the active "more filters" (each clears its own params). */
export function useMoreFilterChips(): ActiveFilter[] {
  const t = useTranslations('influencers.directory');
  const te = useTranslations('enums');
  const sp = useSearchParams();
  const language = useLanguageName();
  const chips: ActiveFilter[] = [];
  const audienceCountry = sp.get('audienceCountry');
  if (audienceCountry)
    chips.push({
      keys: ['audienceCountry', 'audienceMinPct'],
      label: t('chips.audience', {
        country: countryName(audienceCountry) ?? audienceCountry,
        pct: sp.get('audienceMinPct') ?? '1',
      }),
    });
  if (sp.get('minEngagementRate'))
    chips.push({
      keys: ['minEngagementRate'],
      label: t('chips.engagement', { pct: sp.get('minEngagementRate')! }),
    });
  if (sp.get('language'))
    chips.push({
      keys: ['language'],
      label: t('chips.language', { language: language(sp.get('language')!) }),
    });
  if (sp.get('gender'))
    chips.push({ keys: ['gender'], label: enumLabel(te, 'creatorGender', sp.get('gender')!) });
  if (sp.get('minRate') || sp.get('maxRate'))
    chips.push({
      keys: ['minRate', 'maxRate', 'rateCurrency'],
      label: t('chips.fee', {
        from: sp.get('minRate') ?? '0',
        to: sp.get('maxRate') ?? '∞',
        currency: sp.get('rateCurrency') ?? 'KWD',
      }),
    });
  return chips;
}

/**
 * Smarter creator selection (P3.7): audience country share, engagement,
 * language, gender and usual fee — all real server-side filters in the URL.
 */
export function MoreFilters() {
  const t = useTranslations('influencers.directory.moreFilters');
  const te = useTranslations('enums');
  const sp = useSearchParams();
  const setParams = useListParams();
  const name = useCountryName();
  const all = useSortedCountries();
  const language = useLanguageName();
  const active = MORE_FILTER_KEYS.filter(
    (k) => k !== 'audienceMinPct' && k !== 'rateCurrency' && sp.get(k),
  ).length;
  const [minRate, setMinRate] = React.useState(sp.get('minRate') ?? '');
  const [maxRate, setMaxRate] = React.useState(sp.get('maxRate') ?? '');
  const [currency, setCurrency] = React.useState(sp.get('rateCurrency') ?? 'KWD');
  React.useEffect(() => {
    setMinRate(sp.get('minRate') ?? '');
    setMaxRate(sp.get('maxRate') ?? '');
    setCurrency(sp.get('rateCurrency') ?? 'KWD');
  }, [sp]);
  const gulf = GULF_COUNTRY_CODES as readonly string[];
  const audienceCountry = sp.get('audienceCountry') ?? '';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-10 gap-1.5">
          <SlidersHorizontal className="h-4 w-4" />
          {t('button')}
          {active > 0 ? (
            <span className="bg-brand rounded-full px-1.5 text-[11px] font-semibold text-white">
              {active}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,22rem)] space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t('audience')}</p>
          <p className="text-muted-foreground text-xs">{t('audienceHint')}</p>
          <div className="flex gap-2">
            <Select
              value={audienceCountry || ANY}
              onValueChange={(v) =>
                setParams({
                  audienceCountry: v === ANY ? null : v,
                  audienceMinPct: v === ANY ? null : (sp.get('audienceMinPct') ?? '40'),
                })
              }
            >
              <SelectTrigger aria-label={t('audienceCountry')} className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ANY}>{t('any')}</SelectItem>
                {gulf.map((c) => (
                  <SelectItem key={c} value={c}>
                    {name(c)}
                  </SelectItem>
                ))}
                <SelectSeparator />
                {all
                  .filter((c) => !gulf.includes(c.code))
                  .map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select
              value={sp.get('audienceMinPct') ?? '40'}
              disabled={!audienceCountry}
              onValueChange={(v) => setParams({ audienceMinPct: v })}
            >
              <SelectTrigger aria-label={t('audienceShare')} className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUDIENCE_SHARES.map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {t('atLeast', { pct: p })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('engagement')}</p>
            <Select
              value={sp.get('minEngagementRate') ?? ANY}
              onValueChange={(v) => setParams({ minEngagementRate: v === ANY ? null : v })}
            >
              <SelectTrigger aria-label={t('engagement')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('any')}</SelectItem>
                {ENGAGEMENT_FLOORS.map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {t('atLeast', { pct: p })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('gender')}</p>
            <Select
              value={sp.get('gender') ?? ANY}
              onValueChange={(v) => setParams({ gender: v === ANY ? null : v })}
            >
              <SelectTrigger aria-label={t('gender')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('any')}</SelectItem>
                {CREATOR_GENDERS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {enumLabel(te, 'creatorGender', g)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t('language')}</p>
          <Select
            value={sp.get('language') ?? ANY}
            onValueChange={(v) => setParams({ language: v === ANY ? null : v })}
          >
            <SelectTrigger aria-label={t('language')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('any')}</SelectItem>
              {CREATOR_LANGUAGES.map((l) => (
                <SelectItem key={l} value={l}>
                  {language(l)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            setParams({
              minRate: minRate.trim() || null,
              maxRate: maxRate.trim() || null,
              rateCurrency: minRate.trim() || maxRate.trim() ? currency : null,
            });
          }}
        >
          <p className="text-sm font-medium">{t('fee')}</p>
          <p className="text-muted-foreground text-xs">{t('feeHint')}</p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              value={minRate}
              onChange={(e) => setMinRate(e.target.value)}
              aria-label={t('feeFrom')}
              placeholder={t('feeFrom')}
              dir="ltr"
            />
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              value={maxRate}
              onChange={(e) => setMaxRate(e.target.value)}
              aria-label={t('feeTo')}
              placeholder={t('feeTo')}
              dir="ltr"
            />
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
              aria-label={t('feeCurrency')}
              className="w-20"
              dir="ltr"
              maxLength={3}
            />
          </div>
          <Button type="submit" size="sm" variant="secondary" className="w-full">
            {t('apply')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
