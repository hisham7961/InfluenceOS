'use client';

import * as React from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
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
import { dateTime, relativeTime } from '@/lib/format';

const ALL = 'all';

/** Human labels for the action types worth filtering by. */
const ACTION_TYPES = [
  'BRAND_CREATED', 'BRAND_UPDATED',
  'INFLUENCER_ADDED', 'INFLUENCER_UPDATED', 'SOCIAL_ACCOUNT_ADDED', 'INFLUENCER_ADDED_TO_CAMPAIGN',
  'CAMPAIGN_CREATED', 'CAMPAIGN_STATUS_CHANGED', 'CAMPAIGN_UPDATED',
  'DELIVERABLE_ADDED', 'DELIVERABLE_STATUS_CHANGED',
  'SCRIPT_ADDED', 'SCRIPT_UPDATED',
  'CONTENT_PUBLISHED', 'CONTENT_STATUS_CHANGED',
  'COST_ADDED', 'COST_UPDATED', 'NOTE_ADDED', 'FOLLOWER_MILESTONE', 'GENERIC',
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
  const [filters, setFilters] = React.useState<Filters>(EMPTY);
  const [searchInput, setSearchInput] = React.useState('');
  const [selected, setSelected] = React.useState<AuditEntryDTO | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === searchInput.trim() ? f : { ...f, q: searchInput.trim() })), 350);
    return () => clearTimeout(t);
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
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search actions…"
            aria-label="Search audit log"
            className="pl-9"
          />
        </div>

        <Select value={filters.actorId || ALL} onValueChange={(v) => setFilters((f) => ({ ...f, actorId: v === ALL ? '' : v }))}>
          <SelectTrigger className="h-10 w-full sm:w-44"><SelectValue placeholder="Actor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All actors</SelectItem>
            {actors.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.type || ALL} onValueChange={(v) => setFilters((f) => ({ ...f, type: v === ALL ? '' : v }))}>
          <SelectTrigger className="h-10 w-full sm:w-52"><SelectValue placeholder="Action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All actions</SelectItem>
            {ACTION_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.entityType || ALL} onValueChange={(v) => setFilters((f) => ({ ...f, entityType: v === ALL ? '' : v }))}>
          <SelectTrigger className="h-10 w-full sm:w-40"><SelectValue placeholder="Entity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All entities</SelectItem>
            {ENTITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Input type="date" aria-label="From date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="h-10 w-full sm:w-40" />
          <span className="text-xs text-muted-foreground">→</span>
          <Input type="date" aria-label="To date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="h-10 w-full sm:w-40" />
        </div>

        {hasActiveFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
            <X className="h-3.5 w-3.5" /> Reset
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={hasActiveFilters ? 'No matching activity' : 'No activity yet'}
          description={hasActiveFilters ? 'Try widening your filters.' : 'Actions taken across the workspace will be recorded here.'}
        />
      ) : (
        <Card className="divide-y divide-border p-0">
          {items.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelected(entry)}
              className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-surface-muted/60"
            >
              <Avatar name={entry.actorName ?? 'System'} size="sm" className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{entry.message}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{entry.actorName ?? 'System'}</span>
                  <span title={dateTime(entry.createdAt)}>{relativeTime(entry.createdAt)}</span>
                  {entry.entityType ? <span>· {entry.entityType}</span> : null}
                </p>
              </div>
              <Badge tone="neutral" className="shrink-0 font-mono text-[10px]">{entry.type}</Badge>
            </button>
          ))}
        </Card>
      )}

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}

      <AuditDetailDrawer entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function AuditDetailDrawer({ entry, onClose }: { entry: AuditEntryDTO | null; onClose: () => void }) {
  return (
    <Sheet open={Boolean(entry)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        {entry ? (
          <div className="space-y-5">
            <SheetHeader className="space-y-1 text-left">
              <SheetTitle className="text-base">{entry.message}</SheetTitle>
              <SheetDescription className="font-mono text-xs">{entry.type}</SheetDescription>
            </SheetHeader>

            <div className="space-y-2.5">
              <Row label="When" value={dateTime(entry.createdAt)} />
              <Row label="Actor" value={entry.actorName ?? 'System'} />
              {entry.entityType ? <Row label="Entity" value={`${entry.entityType}${entry.entityId ? ` · ${entry.entityId}` : ''}`} /> : null}
              {entry.brandName ? <Row label="Brand" value={entry.brandName} /> : null}
              {entry.campaignName ? <Row label="Campaign" value={entry.campaignName} /> : null}
            </div>

            {entry.meta && Object.keys(entry.meta).length > 0 ? (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</p>
                <pre className="max-h-64 overflow-auto rounded-xl border border-border bg-surface-muted/50 p-3 text-xs">
                  {JSON.stringify(entry.meta, null, 2)}
                </pre>
              </div>
            ) : null}

            {entry.link ? (
              <Button asChild variant="outline" className="w-full">
                <Link href={entry.link}><ExternalLink className="h-4 w-4" /> Open related record</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="truncate text-right text-sm font-medium">{value}</span>
    </div>
  );
}
