'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { enumLabel } from '@/lib/enum-labels';

export type ChipKey = 'all' | 'new' | 'seen' | 'reviewed' | 'reviewLater' | 'unassigned' | 'alerts' | 'today';

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
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');

  // The "unassigned" chip means CONTENT lacking a campaign/influencer link
  // (contentAssociationStatus), never the employee-assignment sense of the
  // same English word — see docs/localization/ar-glossary.md's UNASSIGNED
  // dual-meaning warning. It deliberately does NOT reuse common.unassigned.
  const chipLabels: Record<ChipKey, string> = {
    all: t('feed.chips.all'),
    new: enumLabel(tEnums, 'contentReviewStatus', 'NEW'),
    seen: enumLabel(tEnums, 'contentReviewStatus', 'SEEN'),
    reviewed: enumLabel(tEnums, 'contentReviewStatus', 'REVIEWED'),
    reviewLater: t('reviewMode.reviewLater'),
    unassigned: enumLabel(tEnums, 'contentAssociationStatus', 'UNASSIGNED'),
    alerts: t('feed.summary.alerts'),
    today: tCommon('today'),
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('feed.chips.groupAriaLabel')}>
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
            {chipLabels[key]}
            {count != null ? ` ${count}` : ''}
          </button>
        );
      })}
    </div>
  );
}
