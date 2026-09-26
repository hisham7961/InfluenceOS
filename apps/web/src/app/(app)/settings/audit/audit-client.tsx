'use client';

import * as React from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ExternalLink, ScrollText, Search, X } from 'lucide-react';
import type { AuditEntryDTO, CursorPage } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { useLocalizedFormat } from '@/lib/format';

const ALL = 'all';

/** Human labels for the action types worth filtering by. */
const ACTION_TYPES = [
  'BRAND_CREATED', 'BRAND_UPDATED',
  'INFLUENCER_ADDED', 'INFLUENCER_UPDATED', 'SOCIAL_ACCOUNT_ADDED', 'INFLUENCER_ADDED_TO_CAMPAIGN',
  'CAMPAIGN_CREATED', 'CAMPAIGN_STATUS_CHANGED', 'CAMPAIGN_UPDATED',
  'DELIVERABLE_ADDED', 'DELIVERABLE_STATUS_CHANGED',
  'SCRIPT_ADDED', 'SCRIPT_UPDATED',
  'CONTENT_PUBLISHED', 'CONTENT_STATUS_CHANGED',
  'COST_ADDED', 'COST_UPDATED', 'NOTE_ADDED', 'FOLLOWER_MILESTONE', 'INFLUENCER_CONTACTED', 'GENERIC',
] as const;

const ENTITY_TYPES = ['brand', 'campaign', 'influencer', 'deliverable', 'content'] as const;

interface Filters {
  actorId: string;
  type: string;
  entityType: string;
  from: string;
  to: string;
  q: string;
}
const EMPTY: Filters = { actorId: '', type: '', entityType: '', from: '', to: '', q: '' };

export function AuditLogClient({
  initial,
  actors,
}: {
  initial: CursorPage<AuditEntryDTO>;
  actors: { id: string; name: string }[];
}) {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const { dateTime, relativeTime } = useLocalizedFormat();
  const [filters, setFilters] = React.useState<Filters>(EMPTY);
  const [searchInput, setSearchInput] = React.useState('');
  const [selected, setSelected] = React.useState<AuditEntryDTO | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => (f.q === searchInput.trim() ? f : { ...f, q: searchInput.trim() })), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const isDefault = JSON.stringify(filters) === JSON.stringify(EMPTY);

  const query = useInfiniteQuery({
    queryKey: ['audit-log', filters],
    queryFn: ({ pageParam }) =>
      api.platform.audit({
        cursor: pageParam,
        limit: 50,
        actorId: filters.actorId || undefined,
        type: filters.type || undefined,
        entityType: filters.entityType || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        q: filters.q || undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    initialData: isDefault ? { pages: [initial], pageParams: [undefined] } : undefined,
    staleTime: 15_000,
  });

  const items = React.useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const hasActiveFilters = !isDefault;

  function reset() {
    setSearchInput('');
    setFilters(EMPTY);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card lg:flex-row lg:flex-wrap lg:items-center">
        <div className="relative flex-1 lg:max-w-xs">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('audit.searchPlaceholder')}
            aria-label={t('audit.searchAria')}
            className="ps-9"
          />
        </div>

        <Select value={filters.actorId || ALL} onValueChange={(v) => setFilters((f) => ({ ...f, actorId: v === ALL ? '' : v }))}>
          <SelectTrigger className="h-10 w-full sm:w-44"><SelectValue placeholder={t('audit.actorFilter')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('audit.allActors')}</SelectItem>
            {actors.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <BidiText>{a.name}</BidiText>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.type || ALL} onValueChange={(v) => setFilters((f) => ({ ...f, type: v === ALL ? '' : v }))}>
          <SelectTrigger className="h-10 w-full sm:w-52"><SelectValue placeholder={t('audit.actionFilter')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('audit.allActions')}</SelectItem>
            {ACTION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>{t(`audit.actionType.${type}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.entityType || ALL} onValueChange={(v) => setFilters((f) => ({ ...f, entityType: v === ALL ? '' : v }))}>
          <SelectTrigger className="h-10 w-full sm:w-40"><SelectValue placeholder={t('audit.entityFilter')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('audit.allEntities')}</SelectItem>
            {ENTITY_TYPES.map((type) => (
              <SelectItem key={type} value={type}>{t(`audit.entityType.${type}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Input type="date" aria-label={t('audit.fromDateAria')} value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="h-10 w-full sm:w-40" />
          <span className="text-xs text-muted-foreground">→</span>
          <Input type="date" aria-label={t('audit.toDateAria')} value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="h-10 w-full sm:w-40" />
        </div>

        {hasActiveFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
            <X className="h-3.5 w-3.5" /> {t('audit.reset')}
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={hasActiveFilters ? t('audit.empty.noMatchesTitle') : t('audit.empty.noneYetTitle')}
          description={hasActiveFilters ? t('audit.empty.noMatchesDescription') : t('audit.empty.noneYetDescription')}
        />
      ) : (
        <Card className="divide-y divide-border p-0">
          {items.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelected(entry)}
              className="flex w-full items-start gap-3 p-4 text-start transition-colors hover:bg-surface-muted/60"
            >
              <Avatar name={entry.actorName ?? t('audit.systemActor')} size="sm" className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{entry.message}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">
                    <BidiText>{entry.actorName ?? t('audit.systemActor')}</BidiText>
                  </span>
                  <span title={dateTime(entry.createdAt)}>{relativeTime(entry.createdAt)}</span>
                  {entry.entityType ? <span>· {entry.entityType}</span> : null}
                </p>
              </div>
              <Badge tone="neutral" className="shrink-0 font-mono text-[10px]">
                <LtrText>{entry.type}</LtrText>
              </Badge>
            </button>
          ))}
        </Card>
      )}

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? tCommon('loading') : t('audit.loadMore')}
          </Button>
        </div>
      ) : null}

      <AuditDetailDrawer entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function AuditDetailDrawer({ entry, onClose }: { entry: AuditEntryDTO | null; onClose: () => void }) {
  const t = useTranslations('settings');
  const { dateTime } = useLocalizedFormat();
  return (
    <Sheet open={Boolean(entry)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="end" className="w-full sm:max-w-md">
        {entry ? (
          <div className="space-y-5">
            <SheetHeader className="space-y-1 text-start">
              <SheetTitle className="text-base">{entry.message}</SheetTitle>
              <SheetDescription className="font-mono text-xs">
                <LtrText>{entry.type}</LtrText>
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-2.5">
              <Row label={t('audit.detail.when')} value={dateTime(entry.createdAt)} />
              <Row label={t('audit.detail.actor')} value={<BidiText>{entry.actorName ?? t('audit.systemActor')}</BidiText>} />
              {entry.entityType ? (
                <Row
                  label={t('audit.detail.entity')}
                  value={`${entry.entityType}${entry.entityId ? ` · ${entry.entityId}` : ''}`}
                />
              ) : null}
              {entry.brandName ? <Row label={t('audit.detail.brand')} value={<BidiText>{entry.brandName}</BidiText>} /> : null}
              {entry.campaignName ? (
                <Row label={t('audit.detail.campaign')} value={<BidiText>{entry.campaignName}</BidiText>} />
              ) : null}
            </div>

            {entry.meta && Object.keys(entry.meta).length > 0 ? (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('audit.detail.details')}
                </p>
                <pre className="max-h-64 overflow-auto rounded-xl border border-border bg-surface-muted/50 p-3 text-xs">
                  {JSON.stringify(entry.meta, null, 2)}
                </pre>
              </div>
            ) : null}

            {entry.link ? (
              <Button asChild variant="outline" className="w-full">
                <Link href={entry.link}>
                  <ExternalLink className="h-4 w-4" /> {t('audit.detail.openRelated')}
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="truncate text-end text-sm font-medium">{value}</span>
    </div>
  );
}
