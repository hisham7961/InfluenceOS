'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { UserRound, X } from 'lucide-react';
import { CAMPAIGN_STATUSES } from '@influenceos/shared';
import type { BrandSummaryDTO, CampaignObjective, CampaignStatus } from '@influenceos/contracts';
import { useApp } from '@/components/shell/app-context';
import { FilterChips, SortMenu, useListParams, type ActiveFilter } from '@/components/common/list-controls';
import { cn } from '@/lib/cn';
import { SearchInput } from '@/components/ui/search-input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText } from '@/components/common/bidi-text';
import { useUrlSyncedInput } from '@/lib/use-url-synced-input';

/** Sentinel value for Radix Select's "no filter" option (Select forbids an empty-string item value). */
const ALL = 'all';

/** Every URL param the list filters on — cleared together by "Reset". */
const FILTER_KEYS = ['q', 'brandId', 'status', 'objective', 'ownerId', 'ownerMissing'] as const;

export interface CampaignFiltersProps {
  brands: BrandSummaryDTO[];
  brandId?: string;
  status?: string;
  q?: string;
}

/** Search + brand + status + "my campaigns" + sort for the campaigns list, and the active filters as chips. Drives the URL, the server page re-reads it. */
export function CampaignFilters({ brands, brandId, status, q }: CampaignFiltersProps) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  // Follow the URL (Select, Reset, Back) without overwriting what's being typed.
  const [search, setSearch] = useUrlSyncedInput(q);
  const sp = useSearchParams();
  const setParams = useListParams();
  const { user } = useApp();
  const ownerId = sp.get('ownerId') ?? '';
  const mine = ownerId === user.id;

  function navigate(next: { q?: string; brandId?: string; status?: string }) {
    // Other filters and the sort are kept; changing a filter goes back to page 1.
    setParams(next as Record<string, string>);
  }

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    navigate({ q: search.trim() });
  }

  const hasActiveFilters = FILTER_KEYS.some((k) => sp.get(k));

  const chips: ActiveFilter[] = [];
  if (q) chips.push({ keys: ['q'], label: t('list.chips.search', { q }) });
  if (brandId) chips.push({ keys: ['brandId'], label: brands.find((b) => b.id === brandId)?.name ?? t('list.chips.oneBrand') });
  if (status) chips.push({ keys: ['status'], label: enumLabel(tEnums, 'campaignStatus', status as CampaignStatus) });
  if (sp.get('objective'))
    chips.push({ keys: ['objective'], label: enumLabel(tEnums, 'campaignObjective', sp.get('objective') as CampaignObjective) });
  if (ownerId) chips.push({ keys: ['ownerId'], label: mine ? t('list.myCampaigns') : t('list.chips.ownedBySomeone') });
  if (sp.get('ownerMissing')) chips.push({ keys: ['ownerMissing'], label: t('list.chips.noOwner') });

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card sm:flex-row sm:items-center">
        <form onSubmit={handleSearchSubmit} className="relative flex-1 sm:max-w-sm">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('list.searchPlaceholder')}
            aria-label={t('list.searchAriaLabel')}
          />
        </form>

        <div className="flex flex-1 flex-wrap items-center gap-3">
          <Select value={brandId || ALL} onValueChange={(value) => navigate({ brandId: value === ALL ? '' : value })}>
            <SelectTrigger className="h-10 w-full sm:w-48">
              <SelectValue placeholder={t('fields.brand')} />
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

          <Select value={status || ALL} onValueChange={(value) => navigate({ status: value === ALL ? '' : value })}>
            <SelectTrigger className="h-10 w-full sm:w-44">
              <SelectValue placeholder={t('fields.status')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('list.allStatuses')}</SelectItem>
              {CAMPAIGN_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {enumLabel(tEnums, 'campaignStatus', s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={mine}
            onClick={() => setParams({ ownerId: mine ? null : user.id })}
            className={cn('h-10 gap-1.5', mine && 'border-brand bg-brand-soft text-brand hover:bg-brand-soft')}
          >
            <UserRound className="h-3.5 w-3.5" aria-hidden /> {t('list.myCampaigns')}
          </Button>

          <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
            <SortMenu
              defaultValue="createdAt:desc"
              sort={sp.get('sort') ?? undefined}
              order={sp.get('order') ?? undefined}
              options={[
                { value: 'createdAt:desc', label: t('list.sort.newest') },
                { value: 'createdAt:asc', label: t('list.sort.oldest') },
                { value: 'startDate:asc', label: t('list.sort.startingFirst') },
                { value: 'startDate:desc', label: t('list.sort.startingLast') },
                { value: 'endDate:asc', label: t('list.sort.endingFirst') },
                { value: 'name:asc', label: t('list.sort.nameAsc') },
              ]}
            />
            {hasActiveFilters ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setParams(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
                }}
                className="text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" /> {t('list.resetFilters')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <FilterChips filters={chips} clearKeys={[...FILTER_KEYS]} />
    </div>
  );
}
