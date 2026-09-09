'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABELS } from '@influenceos/shared';
import type { BrandSummaryDTO } from '@influenceos/contracts';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search campaigns…"
          aria-label="Search campaigns"
          className="pl-9"
        />
      </form>

      <div className="flex flex-1 flex-wrap items-center gap-3">
        <Select value={brandId || ALL} onValueChange={(value) => navigate({ brandId: value === ALL ? '' : value })}>
          <SelectTrigger className="h-10 w-full sm:w-48">
            <SelectValue placeholder="Brand" />
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

        <Select value={status || ALL} onValueChange={(value) => navigate({ status: value === ALL ? '' : value })}>
          <SelectTrigger className="h-10 w-full sm:w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {CAMPAIGN_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {CAMPAIGN_STATUS_LABELS[s]}
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
            <X className="h-3.5 w-3.5" /> Reset
          </Button>
        ) : null}
      </div>
    </div>
  );
}
