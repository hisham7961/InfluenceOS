'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, PlaySquare } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { contentReviewStatus } from '@influenceos/shared';
import { enumLabel } from '@/lib/enum-labels';
import { EmptyState } from '@/components/ui/empty-state';
import { ContentCard, ALERT_STATUSES } from './content-card';
import { ContentViewer } from './content-viewer';

interface DayGroup {
  key: string;
  date: Date;
  items: PublishedContentDTO[];
}

interface BrandGroup {
  brandId: string | null;
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  items: PublishedContentDTO[];
}

/** publishedAt when trustworthy/available, detectedAt fallback (item 12) — never mislabel detection time as publication time. */
function contentDate(c: PublishedContentDTO): Date {
  return new Date(c.publishedAt ?? c.detectedAt);
}

function groupByDay(items: PublishedContentDTO[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const item of items) {
    const date = contentDate(item);
    // Bucketed in the VIEWER's own local timezone (Intl/date-fns default to
    // the browser's clock) — never a raw UTC-day grouping, so late-night
    // content doesn't jump to the wrong day (item 11).
    const key = format(date, 'yyyy-MM-dd');
    let group = map.get(key);
    if (!group) {
      group = { key, date, items: [] };
      map.set(key, group);
    }
    group.items.push(item);
  }
  return Array.from(map.values());
}

function groupByBrand(items: PublishedContentDTO[]): BrandGroup[] {
  const map = new Map<string, BrandGroup>();
  for (const item of items) {
    const key = item.brand?.id ?? '__none__';
    let group = map.get(key);
    if (!group) {
      group = {
        brandId: item.brand?.id ?? null,
        brandName: item.brand?.name ?? null,
        logoUrl: item.brand?.logoUrl ?? null,
        primaryColor: item.brand?.primaryColor ?? null,
        items: [],
      };
      map.set(key, group);
    }
    group.items.push(item);
  }
  return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length);
}

/**
 * Live Content's default operational view: content grouped by DAY (correct
 * viewer timezone, item 11-12), then within each day grouped by BRAND (item
 * 13) with a per-brand New count for the current user (item 20). Reuses the
 * SAME PublishedContentDTO records the Grid/Masonry/Feed views render — no
 * second content source — and the SAME ContentCard/ContentViewer.
 */
export function ContentTimeline({ items }: { items: PublishedContentDTO[] }) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const formatter = useFormatter();
  const [index, setIndex] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  const days = React.useMemo(() => groupByDay(items), [items]);

  // "Today"/"Yesterday" reuse common.today/common.yesterday; every other day
  // is a locale-formatted weekday + day + month (Arabic month/weekday names
  // in ar, never a hardcoded English string) — see docs/localization/README.md.
  function dayLabel(date: Date): string {
    if (isToday(date)) {
      return t('timeline.dayWithLabel', {
        label: tCommon('today'),
        date: formatter.dateTime(date, { day: 'numeric', month: 'long' }),
      });
    }
    if (isYesterday(date)) {
      return t('timeline.dayWithLabel', {
        label: tCommon('yesterday'),
        date: formatter.dateTime(date, { day: 'numeric', month: 'long' }),
      });
    }
    return formatter.dateTime(date, { weekday: 'long', day: 'numeric', month: 'long' });
  }

  if (items.length === 0) {
    return <EmptyState icon={PlaySquare} title={t('timeline.emptyTitle')} description={t('timeline.emptyDescription')} />;
  }

  function openAt(content: PublishedContentDTO) {
    const i = items.findIndex((c) => c.id === content.id);
    if (i >= 0) {
      setIndex(i);
      setOpen(true);
    }
  }

  function toggle(groupKey: string) {
    setCollapsed((c) => ({ ...c, [groupKey]: !c[groupKey] }));
  }

  return (
    <div className="space-y-8">
      {days.map((day) => (
        <section key={day.key}>
          <div className="sticky top-16 z-20 -mx-1 mb-4 bg-background/95 px-1 py-2 backdrop-blur">
            <h2 className="text-sm font-semibold text-foreground">{dayLabel(day.date)}</h2>
          </div>
          <div className="space-y-6">
            {groupByBrand(day.items).map((brand) => {
              const groupKey = `${day.key}:${brand.brandId ?? '__none__'}`;
              const newCount = brand.items.filter((c) => contentReviewStatus(c.viewerState) === 'NEW').length;
              const alertCount = brand.items.filter((c) => ALERT_STATUSES.has(c.availabilityStatus)).length;
              // Groups containing New content stay expanded regardless of the
              // collapse toggle — never hide unreviewed work (item 15).
              const isCollapsed = (collapsed[groupKey] ?? false) && newCount === 0;

              return (
                <div key={groupKey}>
                  <button
                    type="button"
                    onClick={() => toggle(groupKey)}
                    className="mb-3 flex w-full items-center gap-2 text-start"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className="h-4 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: brand.primaryColor ?? '#6366F1' }}
                      aria-hidden
                    />
                    {brand.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={brand.logoUrl} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
                    ) : null}
                    <span className="truncate text-sm font-medium text-foreground">
                      {brand.brandName ?? t('timeline.noBrand')}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {brand.items.length} {t('feed.summary.content')}
                      {newCount > 0 ? ` · ${newCount} ${enumLabel(tEnums, 'contentReviewStatus', 'NEW')}` : ''}
                      {alertCount > 0 ? ` · ${alertCount} ${t('feed.summary.alerts')}` : ''}
                    </span>
                  </button>
                  {!isCollapsed ? (
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                      {brand.items.map((content) => (
                        <ContentCard key={content.id} content={content} onOpen={() => openAt(content)} />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <ContentViewer items={items} index={index} onIndexChange={setIndex} open={open} onOpenChange={setOpen} />
    </div>
  );
}
