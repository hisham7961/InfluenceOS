'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import type { Platform, RelationshipStatus } from '@influenceos/contracts';
import { COUNTRIES, PLATFORMS, PLATFORM_META, RELATIONSHIP_STATUSES, countryName } from '@influenceos/shared';
import { useApp } from '@/components/shell/app-context';
import { FilterChips, SortMenu, useListParams, type ActiveFilter } from '@/components/common/list-controls';
import { formatCompact } from '@/lib/format';
import { enumLabel } from '@/lib/enum-labels';
import { SearchInput } from '@/components/ui/search-input';
import { Button } from '@/components/ui/button';
import { useUrlSyncedInput } from '@/lib/use-url-synced-input';
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

/** Follower ranges offered in the directory (any account's followers, server-side). */
const FOLLOWER_RANGES = [
  { key: 'u10k', min: undefined, max: 9_999 },
  { key: '10k-100k', min: 10_000, max: 99_999 },
  { key: '100k-1m', min: 100_000, max: 999_999 },
  { key: '1m', min: 1_000_000, max: undefined },
] as const;

/** Every URL param the directory filters on — cleared together by "Reset". */
const FILTER_KEYS = [
  'q',
  'platform',
  'relationshipStatus',
  'countryCode',
  'country',
  'city',
  'category',
  'minFollowers',
  'maxFollowers',
  'ownerId',
  'missingCountry',
  'missingOwner',
  'missingPhone',
  'missingSocial',
] as const;

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
  const t = useTranslations('influencers');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
  // Follow the URL (Select, Reset, Back) without overwriting what's being typed.
  const [search, setSearch] = useUrlSyncedInput(q);
  const [cityInput, setCityInput] = useUrlSyncedInput(city);
  const sp = useSearchParams();
  const setParams = useListParams();
  const { user } = useApp();
  const [categoryInput, setCategoryInput] = useUrlSyncedInput(sp.get('category') ?? undefined);
  const minFollowers = sp.get('minFollowers') ?? '';
  const maxFollowers = sp.get('maxFollowers') ?? '';
  const ownerId = sp.get('ownerId') ?? '';
  const followerRange =
    FOLLOWER_RANGES.find((r) => String(r.min ?? '') === minFollowers && String(r.max ?? '') === maxFollowers)?.key ?? (minFollowers || maxFollowers ? 'custom' : ALL);

  function navigate(next: {
    q?: string;
    platform?: string;
    relationshipStatus?: string;
    countryCode?: string;
    city?: string;
  }) {
    // Other filters (hidden deep-link ones included) and the sort are kept;
    // changing a filter always goes back to page 1.
    setParams(next as Record<string, string>);
  }

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    navigate({ q: search.trim() });
  }

  function handleCitySubmit(event: React.FormEvent) {
    event.preventDefault();
    navigate({ city: cityInput.trim() });
  }

  const hasActiveFilters = FILTER_KEYS.some((k) => sp.get(k));

  // The active filters as chips, including those that only arrive by link.
  // "Under 10K", "10K–100K", "1M+": a range's top is shown as the next round number.
  const followersLabel = (min: string, max: string) =>
    min && max
      ? t('directory.filters.followersBetween', { min: formatCompact(Number(min)), max: formatCompact(Number(max) + 1) })
      : min
        ? t('directory.filters.followersAtLeast', { min: formatCompact(Number(min)) })
        : t('directory.filters.followersUnder', { max: formatCompact(Number(max) + 1) });
  const chips: ActiveFilter[] = [];
  if (q) chips.push({ keys: ['q'], label: t('directory.chips.search', { q }) });
  if (platform) chips.push({ keys: ['platform'], label: PLATFORM_META[platform as Platform]?.label ?? platform });
  if (relationshipStatus)
    chips.push({ keys: ['relationshipStatus'], label: enumLabel(te, 'relationshipStatus', relationshipStatus as RelationshipStatus) });
  if (countryCode) chips.push({ keys: ['countryCode'], label: countryName(countryCode) ?? countryCode });
  if (sp.get('country')) chips.push({ keys: ['country'], label: sp.get('country')! });
  if (city) chips.push({ keys: ['city'], label: t('directory.chips.city', { city }) });
  if (sp.get('category')) chips.push({ keys: ['category'], label: t('directory.chips.category', { category: sp.get('category')! }) });
  if (minFollowers || maxFollowers) chips.push({ keys: ['minFollowers', 'maxFollowers'], label: followersLabel(minFollowers, maxFollowers) });
  if (ownerId)
    chips.push({
      keys: ['ownerId'],
      label: ownerId === user.id ? t('directory.chips.ownedByMe') : ownerId === 'unowned' ? t('directory.chips.noOwner') : t('directory.chips.ownedBySomeone'),
    });
  if (sp.get('missingCountry') === 'true') chips.push({ keys: ['missingCountry'], label: t('directory.chips.missingCountry') });
  if (sp.get('missingOwner') === 'true') chips.push({ keys: ['missingOwner'], label: t('directory.chips.noOwner') });
  if (sp.get('missingPhone') === 'true') chips.push({ keys: ['missingPhone'], label: t('directory.chips.missingPhone') });
  if (sp.get('missingSocial') === 'true') chips.push({ keys: ['missingSocial'], label: t('directory.chips.missingSocial') });

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

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setParams({ category: categoryInput.trim() });
            }}
            className="w-full sm:w-40"
          >
            <SearchInput
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              placeholder={t('directory.filters.categoryPlaceholder')}
              aria-label={t('directory.filters.categoryAriaLabel')}
            />
          </form>

          <Select
            value={followerRange}
            onValueChange={(value) => {
              const r = FOLLOWER_RANGES.find((x) => x.key === value);
              setParams({ minFollowers: r?.min != null ? String(r.min) : null, maxFollowers: r?.max != null ? String(r.max) : null });
            }}
          >
            <SelectTrigger className="h-10 w-full sm:w-44" aria-label={t('directory.filters.followersLabel')}>
              <SelectValue placeholder={t('directory.filters.followersAny')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('directory.filters.followersAny')}</SelectItem>
              {FOLLOWER_RANGES.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {followersLabel(r.min != null ? String(r.min) : '', r.max != null ? String(r.max) : '')}
                </SelectItem>
              ))}
              {followerRange === 'custom' ? (
                <SelectItem value="custom" disabled>
                  {followersLabel(minFollowers, maxFollowers)}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>

          <Select
            value={ownerId === user.id ? 'me' : ownerId === 'unowned' ? 'unowned' : ownerId ? 'other' : ALL}
            onValueChange={(value) => setParams({ ownerId: value === 'me' ? user.id : value === 'unowned' ? 'unowned' : null })}
          >
            <SelectTrigger className="h-10 w-full sm:w-40" aria-label={t('directory.filters.ownerLabel')}>
              <SelectValue placeholder={t('directory.filters.ownerAnyone')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('directory.filters.ownerAnyone')}</SelectItem>
              <SelectItem value="me">{t('directory.chips.ownedByMe')}</SelectItem>
              <SelectItem value="unowned">{t('directory.chips.noOwner')}</SelectItem>
              {ownerId && ownerId !== user.id && ownerId !== 'unowned' ? (
                <SelectItem value="other" disabled>
                  {t('directory.chips.ownedBySomeone')}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>

          <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
            <SavedViews
              scope="influencers"
              basePath="/influencers"
              current={{
                q: q ?? '',
                platform: platform ?? '',
                relationshipStatus: relationshipStatus ?? '',
                countryCode: countryCode ?? '',
                city: city ?? '',
                category: sp.get('category') ?? '',
                minFollowers,
                maxFollowers,
                ownerId,
                sort: sp.get('sort') ?? '',
                order: sp.get('order') ?? '',
              }}
            />
            <SortMenu
              defaultValue="createdAt:desc"
              sort={sp.get('sort') ?? undefined}
              order={sp.get('order') ?? undefined}
              options={[
                { value: 'createdAt:desc', label: t('directory.sort.newest') },
                { value: 'createdAt:asc', label: t('directory.sort.oldest') },
                { value: 'name:asc', label: t('directory.sort.nameAsc') },
                { value: 'name:desc', label: t('directory.sort.nameDesc') },
                { value: 'updatedAt:desc', label: t('directory.sort.updated') },
              ]}
            />
            {hasActiveFilters ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setCityInput('');
                  setCategoryInput('');
                  setParams(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
                }}
                className="text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" /> {t('directory.filters.reset')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <FilterChips filters={chips} clearKeys={[...FILTER_KEYS]} />
    </div>
  );
}
