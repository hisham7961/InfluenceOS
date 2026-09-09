'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { PLATFORMS, PLATFORM_META, RELATIONSHIP_STATUSES, RELATIONSHIP_STATUS_LABELS } from '@influenceos/shared';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Sentinel value for Radix Select's "no filter" option (Select forbids an empty-string item value). */
const ALL = 'all';

export interface DirectoryFiltersProps {
  q?: string;
  platform?: string;
  relationshipStatus?: string;
}

/** Search + platform + relationship filter bar for the influencer directory. Drives the URL, the server page re-reads it. */
export function DirectoryFilters({ q, platform, relationshipStatus }: DirectoryFiltersProps) {
  const router = useRouter();
  const [search, setSearch] = React.useState(q ?? '');

  // Keep the local input in sync when filters change via a Select or Reset (which don't touch this state directly).
  React.useEffect(() => {
    setSearch(q ?? '');
  }, [q]);

  function navigate(next: { q?: string; platform?: string; relationshipStatus?: string }) {
    const merged = {
      q: next.q !== undefined ? next.q : (q ?? ''),
      platform: next.platform !== undefined ? next.platform : (platform ?? ''),
      relationshipStatus:
        next.relationshipStatus !== undefined ? next.relationshipStatus : (relationshipStatus ?? ''),
    };
    const params = new URLSearchParams();
    if (merged.q) params.set('q', merged.q);
    if (merged.platform) params.set('platform', merged.platform);
    if (merged.relationshipStatus) params.set('relationshipStatus', merged.relationshipStatus);
    // Changing a filter always resets pagination back to page 1.
    const qs = params.toString();
    router.push(qs ? `/influencers?${qs}` : '/influencers');
  }

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    navigate({ q: search.trim() });
  }

  const hasActiveFilters = Boolean(q || platform || relationshipStatus);

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card sm:flex-row sm:items-center">
      <form onSubmit={handleSearchSubmit} className="relative flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or @username…"
          aria-label="Search influencers"
          className="pl-9"
        />
      </form>

      <div className="flex flex-1 flex-wrap items-center gap-3">
        <Select value={platform || ALL} onValueChange={(value) => navigate({ platform: value === ALL ? '' : value })}>
          <SelectTrigger className="h-10 w-full sm:w-44">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All platforms</SelectItem>
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
            <SelectValue placeholder="Relationship" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All relationships</SelectItem>
            {RELATIONSHIP_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {RELATIONSHIP_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.push('/influencers')}
            className="text-muted-foreground sm:ml-auto"
          >
            <X className="h-3.5 w-3.5" /> Reset
          </Button>
        ) : null}
      </div>
    </div>
  );
}
