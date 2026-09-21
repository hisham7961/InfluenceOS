'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { COUNTRIES, PLATFORMS, PLATFORM_META, RELATIONSHIP_STATUSES } from '@influenceos/shared';
import { enumLabel } from '@/lib/enum-labels';
import { SearchInput } from '@/components/ui/search-input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SavedViews } from './saved-views';
import { InfluencerCountryStrip } from './influencer-country-strip';

/** Sentinel value for Radix Select's "no filter" option (Select forbids an empty-string item value). */
const ALL = 'all';

export interface DirectoryFiltersProps {
  q?: string;
  platform?: string;
  relationshipStatus?: string;
  countryCode?: string;
  city?: string;
}

/** Search + platform + relationship + country/city filter bar for the influencer directory. Drives the URL, the server page re-reads it — every dimension is a real server-side filter, never a client-side post-filter of a downloaded page. */
export function DirectoryFilters({
  q,
  platform,
  relationshipStatus,
  countryCode,
  city,
}: DirectoryFiltersProps) {
  const router = useRouter();
  const t = useTranslations('influencers');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
  const [search, setSearch] = React.useState(q ?? '');
  const [cityInput, setCityInput] = React.useState(city ?? '');

  // Keep the local input in sync when filters change via a Select or Reset (which don't touch this state directly).
  React.useEffect(() => {
    setSearch(q ?? '');
  }, [q]);
  React.useEffect(() => {
    setCityInput(city ?? '');
  }, [city]);

  function navigate(next: {
    q?: string;
    platform?: string;
    relationshipStatus?: string;
    countryCode?: string;
    city?: string;
  }) {
    const merged = {
      q: next.q !== undefined ? next.q : (q ?? ''),
      platform: next.platform !== undefined ? next.platform : (platform ?? ''),
      relationshipStatus:
        next.relationshipStatus !== undefined
          ? next.relationshipStatus
          : (relationshipStatus ?? ''),
      countryCode: next.countryCode !== undefined ? next.countryCode : (countryCode ?? ''),
      city: next.city !== undefined ? next.city : (city ?? ''),
    };
    const params = new URLSearchParams();
    if (merged.q) params.set('q', merged.q);
    if (merged.platform) params.set('platform', merged.platform);
    if (merged.relationshipStatus) params.set('relationshipStatus', merged.relationshipStatus);
    if (merged.countryCode) params.set('countryCode', merged.countryCode);
    if (merged.city) params.set('city', merged.city);
    // Changing a filter always resets pagination back to page 1.
    const qs = params.toString();
    router.push(qs ? `/influencers?${qs}` : '/influencers');
  }

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    navigate({ q: search.trim() });
  }

  function handleCitySubmit(event: React.FormEvent) {
    event.preventDefault();
    navigate({ city: cityInput.trim() });
  }

  const hasActiveFilters = Boolean(q || platform || relationshipStatus || countryCode || city);

  return (
    <div className="mb-6 space-y-3">
      <InfluencerCountryStrip
        filters={{ q, platform, relationshipStatus, countryCode, city }}
        selected={countryCode ?? ''}
        onSelect={(code) => navigate({ countryCode: code })}
      />

      <div className="border-border bg-card shadow-card flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center">
        <form onSubmit={handleSearchSubmit} className="relative flex-1 sm:max-w-sm">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('directory.filters.searchPlaceholder')}
            aria-label={t('directory.filters.searchAriaLabel')}
          />
        </form>

        <div className="flex flex-1 flex-wrap items-center gap-3">
          <Select
            value={platform || ALL}
            onValueChange={(value) => navigate({ platform: value === ALL ? '' : value })}
          >
            <SelectTrigger className="h-10 w-full sm:w-44">
              <SelectValue placeholder={t('directory.filters.platformPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('directory.filters.allPlatforms')}</SelectItem>
              {PLATFORMS.map((p) => (
                <SelectItem key={p} value={p}>
                  {PLATFORM_META[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={relationshipStatus || ALL}
            onValueChange={(value) => navigate({ relationshipStatus: value === ALL ? '' : value })}
          >
            <SelectTrigger className="h-10 w-full sm:w-48">
              <SelectValue placeholder={t('directory.filters.relationshipPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('directory.filters.allRelationships')}</SelectItem>
              {RELATIONSHIP_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {enumLabel(te, 'relationshipStatus', status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={countryCode || ALL}
            onValueChange={(value) => navigate({ countryCode: value === ALL ? '' : value })}
          >
            <SelectTrigger className="h-10 w-full sm:w-44">
              <SelectValue placeholder={t('directory.filters.countryPlaceholder')} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ALL}>{tc('allCountries')}</SelectItem>
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <form onSubmit={handleCitySubmit} className="w-full sm:w-40">
            <SearchInput
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              placeholder={t('directory.filters.cityPlaceholder')}
              aria-label={t('directory.filters.cityAriaLabel')}
            />
          </form>

          <div className="flex items-center gap-2 sm:ms-auto">
            <SavedViews
              scope="influencers"
              basePath="/influencers"
              current={{
                q: q ?? '',
                platform: platform ?? '',
                relationshipStatus: relationshipStatus ?? '',
                countryCode: countryCode ?? '',
                city: city ?? '',
              }}
            />
            {hasActiveFilters ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => router.push('/influencers')}
                className="text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" /> {t('directory.filters.reset')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
