'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowDownUp, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * List controls shared by the directories (P2.8): a sort menu and the active
 * filters as removable chips — including filters that only arrive through a
 * link (e.g. "no country" from Data Quality) and have no control on screen.
 */

/** Change some of the list's URL params (others kept; back to page 1). `null` removes one. */
export function useListParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return React.useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') params.delete(key);
        else params.set(key, value);
      }
      params.delete('page');
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );
}

export interface SortOption {
  /** `field:asc|desc` */
  value: string;
  label: string;
}

/** Sort menu. The choice lives in the URL as `sort` + `order`. */
export function SortMenu({ options, sort, order, defaultValue }: { options: SortOption[]; sort?: string; order?: string; defaultValue: string }) {
  const t = useTranslations('common');
  const setParams = useListParams();
  const current = sort ? `${sort}:${order === 'asc' ? 'asc' : 'desc'}` : defaultValue;
  const active = options.find((o) => o.value === current) ?? options.find((o) => o.value === defaultValue)!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-10 gap-1.5" aria-label={t('listControls.sortBy', { option: active.label })}>
          <ArrowDownUp className="h-3.5 w-3.5" aria-hidden />
          <span className="max-w-40 truncate">{active.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('listControls.sort')}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => {
              const [field, dir] = o.value.split(':');
              setParams(o.value === defaultValue ? { sort: null, order: null } : { sort: field!, order: dir! });
            }}
            className="gap-2"
          >
            <Check className={o.value === active.value ? 'h-3.5 w-3.5' : 'h-3.5 w-3.5 opacity-0'} aria-hidden />
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface ActiveFilter {
  /** URL param(s) this chip clears. */
  keys: string[];
  label: string;
}

/** The active filters as chips; × removes one, "Clear all" removes them all. */
export function FilterChips({ filters, clearKeys }: { filters: ActiveFilter[]; clearKeys?: string[] }) {
  const t = useTranslations('common');
  const setParams = useListParams();
  if (filters.length === 0) return null;
  const all = clearKeys ?? [...new Set(filters.flatMap((f) => f.keys))];
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={t('listControls.activeFilters')}>
      {filters.map((f) => (
        <span
          key={f.keys.join(',')}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand/30 bg-brand-soft py-0.5 pe-1 ps-3 text-xs font-medium text-brand"
        >
          <span className="truncate">{f.label}</span>
          <button
            type="button"
            onClick={() => setParams(Object.fromEntries(f.keys.map((k) => [k, null])))}
            className="rounded-full p-0.5 transition-colors hover:bg-brand/15"
            aria-label={t('listControls.removeFilter', { filter: f.label })}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {filters.length > 1 ? (
        <button
          type="button"
          onClick={() => setParams(Object.fromEntries(all.map((k) => [k, null])))}
          className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t('listControls.clearAll')}
        </button>
      ) : null}
    </div>
  );
}
