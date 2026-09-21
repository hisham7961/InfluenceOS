'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Globe2 } from 'lucide-react';
import { countryName } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

/**
 * The country-first summary strip (Advanced Roles & Logistics Operations
 * pass) — one chip per destination country the viewer's own scope permits,
 * with a total and a "needs attention" count. Clicking a chip toggles the
 * destination-country filter; every OTHER active filter still applies (a
 * facet count, not a second, independent query).
 */
export function LogisticsCountryStrip({
  filters,
  selected,
  onSelect,
}: {
  filters: Record<string, string | undefined>;
  selected: string;
  onSelect: (countryCode: string) => void;
}) {
  const t = useTranslations('logistics');
  const tc = useTranslations('common');
  const query = useQuery({
    queryKey: ['logistics-summary', filters],
    queryFn: () => api.shipments.summary(filters),
  });

  const rows = query.data ?? [];
  const totalAll = rows.reduce((sum, r) => sum + r.total, 0);
  const attentionAll = rows.reduce((sum, r) => sum + r.needsAttention, 0);

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
    <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t('countryStrip.filterAriaLabel')}>
      <Chip
        icon={<Globe2 className="h-3.5 w-3.5" />}
        label={tc('allCountries')}
        total={totalAll}
        attention={attentionAll}
        active={selected === ''}
        onClick={() => onSelect('')}
      />
      {rows.map((r) => (
        <Chip
          key={r.countryCode ?? '__none__'}
          label={r.countryName ?? countryName(r.countryCode) ?? tc('unknown')}
          code={r.countryCode}
          total={r.total}
          attention={r.needsAttention}
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
  attention,
  active,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  code?: string | null;
  total: number;
  attention: number;
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
      {code && <span className="text-xs text-muted-foreground">{code}</span>}
      <span>{label}</span>
      <span className={cn('rounded-full px-1.5 py-0.5 text-xs', active ? 'bg-brand/15' : 'bg-surface-muted')}>{total}</span>
      {attention > 0 && (
        <span className="flex items-center gap-0.5 rounded-full bg-danger/10 px-1.5 py-0.5 text-xs font-semibold text-danger">
          <AlertTriangle className="h-3 w-3" /> {attention}
        </span>
      )}
    </button>
  );
}
