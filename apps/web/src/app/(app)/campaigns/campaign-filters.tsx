'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { CAMPAIGN_STATUSES } from '@influenceos/shared';
import type { BrandSummaryDTO } from '@influenceos/contracts';
import { SearchInput } from '@/components/ui/search-input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText } from '@/components/common/bidi-text';

/** Sentinel value for Radix Select's "no filter" option (Select forbids an empty-string item value). */
const ALL = 'all';

export interface CampaignFiltersProps {
  brands: BrandSummaryDTO[];
  brandId?: string;
  status?: string;
  q?: string;
}

/** Search + brand + status filter bar for the campaigns list. Drives the URL, the server page re-reads it. */
export function CampaignFilters({ brands, brandId, status, q }: CampaignFiltersProps) {
  const router = useRouter();
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const [search, setSearch] = React.useState(q ?? '');

  // Keep the local input in sync when filters change via a Select or Reset (which don't touch this state directly).
  React.useEffect(() => {
    setSearch(q ?? '');
  }, [q]);

  function navigate(next: { q?: string; brandId?: string; status?: string }) {
    const merged = {
      q: next.q !== undefined ? next.q : (q ?? ''),
      brandId: next.brandId !== undefined ? next.brandId : (brandId ?? ''),
      status: next.status !== undefined ? next.status : (status ?? ''),
    };
    const params = new URLSearchParams();
    if (merged.q) params.set('q', merged.q);
    if (merged.brandId) params.set('brandId', merged.brandId);
    if (merged.status) params.set('status', merged.status);
    // Changing a filter always resets pagination back to page 1.
    const qs = params.toString();
    router.push(qs ? `/campaigns?${qs}` : '/campaigns');
  }

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    navigate({ q: search.trim() });
  }

  const hasActiveFilters = Boolean(q || brandId || status);

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card sm:flex-row sm:items-center">
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

        {hasActiveFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.push('/campaigns')}
            className="text-muted-foreground sm:ml-auto"
          >
            <X className="h-3.5 w-3.5" /> {t('list.resetFilters')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
