'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  AlarmClock,
  CalendarClock,
  ClipboardCheck,
  Inbox,
  MapPin,
  Package,
  Search,
  type LucideIcon,
} from 'lucide-react';
import type { WorkItemDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { useLocalizedFormat } from '@/lib/format';
import { BidiText } from '@/components/common/bidi-text';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

const ORDER: WorkItemDTO['kind'][] = [
  'DELIVERABLE_OVERDUE',
  'DRAFT_TO_REVIEW',
  'DELIVERABLE_DUE_SOON',
  'LOGISTICS_ISSUE',
  'SHIPMENT',
  'FOUND_POSTS',
];

const ICON: Record<WorkItemDTO['kind'], LucideIcon> = {
  DELIVERABLE_OVERDUE: AlarmClock,
  DRAFT_TO_REVIEW: ClipboardCheck,
  DELIVERABLE_DUE_SOON: CalendarClock,
  LOGISTICS_ISSUE: MapPin,
  SHIPMENT: Package,
  FOUND_POSTS: Search,
};

/** My work (P3.6): what's waiting on the viewer, grouped, most urgent first. */
export function MyWork() {
  const t = useTranslations('work.myWork');
  const query = useQuery({ queryKey: ['my-work'], queryFn: () => api.work.mine() });

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  const data = query.data;
  if (!data) return null;

  const groups = ORDER.map((kind) => ({
    kind,
    items: data.items.filter((i) => i.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      {!data.ownsAnything ? (
        <p className="border-border text-muted-foreground rounded-xl border border-dashed px-4 py-3 text-sm">
          {t('ownsNothing')}
        </p>
      ) : null}
      {groups.length === 0 ? (
        <EmptyState icon={Inbox} title={t('empty')} className="py-16" />
      ) : (
        groups.map((g) => {
          const Icon = ICON[g.kind];
          return (
            <section key={g.kind} aria-labelledby={`work-${g.kind}`} className="space-y-2">
              <h2 id={`work-${g.kind}`} className="flex items-center gap-2 text-sm font-semibold">
                <Icon
                  className={cn(
                    'h-4 w-4',
                    g.kind === 'DELIVERABLE_OVERDUE' ? 'text-danger' : 'text-muted-foreground',
                  )}
                />
                {t(`sections.${g.kind}`)}
                <span className="text-muted-foreground">({g.items.length})</span>
              </h2>
              <Card className="divide-border divide-y overflow-hidden">
                {g.items.map((item) => (
                  <WorkRow key={item.id} item={item} />
                ))}
              </Card>
            </section>
          );
        })
      )}
    </div>
  );
}

function WorkRow({ item }: { item: WorkItemDTO }) {
  const t = useTranslations('work.myWork');
  const tEnums = useTranslations('enums');
  const { shortDate, relativeTime } = useLocalizedFormat();
  const p = item.params;
  const what =
    item.kind === 'SHIPMENT'
      ? enumLabel(tEnums, 'shipmentStatus', String(p.status ?? ''))
      : item.kind === 'LOGISTICS_ISSUE'
        ? enumLabel(tEnums, 'logisticsIssueType', String(p.issueType ?? ''))
        : item.kind === 'FOUND_POSTS'
          ? t('foundCount', { count: Number(p.count ?? 0) })
          : enumLabel(tEnums, 'deliverableType', String(p.type ?? ''));
  const when = !item.at
    ? null
    : item.kind === 'DELIVERABLE_OVERDUE' || item.kind === 'DELIVERABLE_DUE_SOON'
      ? t('due', { date: shortDate(item.at) })
      : t('waitingSince', { time: relativeTime(item.at) });

  return (
    <Link
      href={item.link}
      className="hover:bg-surface-muted/60 focus-visible:bg-surface-muted/60 flex items-center gap-3 px-4 py-3 transition-colors focus-visible:outline-none"
    >
      {item.creator ? (
        <Avatar name={item.creator.name} src={item.creator.avatarUrl} size="sm" />
      ) : (
        <span className="bg-surface-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
          <Search className="text-muted-foreground h-4 w-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {item.creator ? <BidiText>{item.creator.name}</BidiText> : null}
          {item.creator && item.campaign ? (
            <span className="text-muted-foreground"> · </span>
          ) : null}
          {item.campaign ? (
            <BidiText className={item.creator ? 'text-muted-foreground' : undefined}>
              {item.campaign.name}
            </BidiText>
          ) : null}
        </p>
        <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
          {p.platform ? <PlatformBadge platform={String(p.platform) as never} size="sm" /> : null}
          <span>{what}</span>
          {when ? (
            <span className={item.kind === 'DELIVERABLE_OVERDUE' ? 'text-danger' : undefined}>
              · {when}
            </span>
          ) : null}
        </p>
      </div>
    </Link>
  );
}
