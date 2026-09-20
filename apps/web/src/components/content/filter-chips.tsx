'use client';

import { cn } from '@/lib/cn';

export type ChipKey = 'all' | 'new' | 'seen' | 'reviewed' | 'reviewLater' | 'unassigned' | 'alerts' | 'today';

const CHIP_LABELS: Record<ChipKey, string> = {
  all: 'All',
  new: 'New',
  seen: 'Seen',
  reviewed: 'Reviewed',
  reviewLater: 'Review Later',
  unassigned: 'Unassigned',
  alerts: 'Alerts',
  today: 'Today',
};

const ORDER: ChipKey[] = ['all', 'new', 'seen', 'reviewed', 'reviewLater', 'unassigned', 'alerts', 'today'];

/**
 * Fast operational chips (item 8) — counts come from GET /content/summary
 * (one server aggregate, never one request per chip). Zero-count chips are
 * hidden except "All", so the row doesn't clutter on a quiet day.
 */
export function ContentFilterChips({
  active,
  counts,
  onSelect,
}: {
  active: ChipKey;
  counts: Partial<Record<ChipKey, number>>;
  onSelect: (key: ChipKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Content filters">
      {ORDER.map((key) => {
        const count = counts[key];
        if (key !== 'all' && !count) return null;
        const isActive = active === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              isActive
                ? 'border-brand bg-brand text-brand-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-brand/40 hover:text-foreground',
            )}
          >
            {CHIP_LABELS[key]}
            {count != null ? ` ${count}` : ''}
          </button>
        );
      })}
    </div>
  );
}
