'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Globe2 } from 'lucide-react';
import { countryName } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

/**
 * The Influencer Directory's country-first summary strip (Master
 * Reconciliation pass, items 80/81 — "All Creators 284, Kuwait 126…") — one
 * chip per country the viewer's own scope permits, with a real server-side
 * count. Clicking a chip toggles the SAME directory's countryCode filter;
 * every other active filter still applies (a facet count, not a second,
 * independent query or a separate country page). Mirrors
 * logistics-country-strip.tsx exactly.
 */
export function InfluencerCountryStrip({
  filters,
  selected,
  onSelect,
}: {
  filters: Record<string, string | undefined>;
  selected: string;
  onSelect: (countryCode: string) => void;
}) {
  const t = useTranslations('influencers');
  const tc = useTranslations('common');
  const query = useQuery({
    queryKey: ['influencer-country-summary', filters],
    queryFn: () => api.influencers.countrySummary(filters),
  });

  const rows = query.data ?? [];
  const totalAll = rows.reduce((sum, r) => sum + r.total, 0);

  if (query.isLoading) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 shrink-0 rounded-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t('directory.countryStrip.ariaLabel')}>
      <Chip
        icon={<Globe2 className="h-3.5 w-3.5" />}
        label={t('directory.countryStrip.allCreators')}
        total={totalAll}
        active={selected === ''}
        onClick={() => onSelect('')}
      />
      {rows.map((r) => (
        <Chip
          key={r.countryCode ?? '__none__'}
          label={r.countryName ?? countryName(r.countryCode) ?? tc('unknown')}
          code={r.countryCode}
          total={r.total}
          active={selected === (r.countryCode ?? '')}
          onClick={() => onSelect(r.countryCode ?? '')}
        />
      ))}
    </div>
  );
}

function Chip({
  icon,
  label,
  code,
  total,
  active,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  code?: string | null;
  total: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-brand bg-brand-soft text-brand'
          : 'border-border bg-card text-foreground hover:bg-surface-muted',
      )}
    >
      {icon}
      {code && <span className="text-muted-foreground text-xs">{code}</span>}
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-xs',
          active ? 'bg-brand/15' : 'bg-surface-muted',
        )}
      >
        {total}
      </span>
    </button>
  );
}
