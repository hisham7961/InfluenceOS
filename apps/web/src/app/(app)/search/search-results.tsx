'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Megaphone, PlaySquare, Search, Store } from 'lucide-react';
import type { RankedSearchResultDTO, SearchPageDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { useReplaceQuery, useUrlPage } from '@/lib/use-url-page';
import { useUrlSyncedInput } from '@/lib/use-url-synced-input';
import { BidiText } from '@/components/common/bidi-text';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageFooter } from '@/components/ui/page-footer';
import { SafeImg } from '@/components/ui/safe-img';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';

type ResultType = keyof SearchPageDTO['counts'];
const TYPES: ResultType[] = ['influencer', 'campaign', 'brand', 'published_content'];
const PAGE_SIZE = 20;
/** The server ranks up to this many matches per type (see search.service). */
const CANDIDATE_CAP = 60;

/**
 * The full search page (P3.7): everything the command palette finds and
 * more — notes, tags, captions — ranked, split by type, and paginated. The
 * query, type and page live in the address so results can be shared.
 */
export function SearchResults() {
  const t = useTranslations('search');
  const params = useSearchParams();
  const replace = useReplaceQuery();
  const [page, setPage] = useUrlPage();
  const q = params?.get('q')?.trim() ?? '';
  const typeParam = params?.get('type');
  const type = TYPES.includes(typeParam as ResultType) ? (typeParam as ResultType) : null;
  const [input, setInput] = useUrlSyncedInput(q);

  // Follow the typing, a moment after it stops.
  React.useEffect(() => {
    const next = input.trim();
    if (next === q) return;
    const id = window.setTimeout(() => replace({ q: next || null, page: null }), 300);
    return () => window.clearTimeout(id);
  }, [input, q, replace]);

  const query = useQuery({
    queryKey: ['search-page', q, type, page],
    queryFn: () =>
      api.search.page({ q, page, pageSize: PAGE_SIZE, ...(type ? { types: type } : {}) }),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  });
  const data = q ? query.data : undefined;
  const allCount = data ? TYPES.reduce((n, k) => n + data.counts[k], 0) : 0;
  const anyCapped = data ? TYPES.some((k) => data.counts[k] >= CANDIDATE_CAP) : false;

  return (
    <div className="space-y-4">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          replace({ q: input.trim() || null, page: null });
        }}
      >
        <SearchInput
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('searchLabel')}
          autoFocus
          className="h-11 text-base"
        />
      </form>

      {q ? (
        <div
          role="tablist"
          aria-label={t('title')}
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
        >
          {([null, ...TYPES] as (ResultType | null)[]).map((k) => {
            const count = data ? (k ? data.counts[k] : allCount) : null;
            const selected = type === k;
            return (
              <button
                key={k ?? 'all'}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => replace({ type: k, page: null })}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  selected
                    ? 'border-brand bg-brand text-brand-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`tabs.${k ?? 'all'}`)}
                {count != null ? (
                  <span className="ms-1.5 tabular-nums opacity-80">
                    {k
                      ? count >= CANDIDATE_CAP
                        ? `${CANDIDATE_CAP}+`
                        : count
                      : anyCapped
                        ? `${count}+`
                        : count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {!q ? (
        <EmptyState icon={Search} title={t('start')} className="py-16" />
      ) : query.isLoading ? (
        <Card className="divide-border divide-y overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </Card>
      ) : data && data.results.length > 0 ? (
        <>
          {data.truncated ? (
            <p className="text-muted-foreground text-sm">{t('truncated')}</p>
          ) : null}
          <Card className="overflow-hidden">
            <ul className="divide-border divide-y">
              {data.results.map((r) => (
                <li key={`${r.type}-${r.id}`}>
                  <ResultRow result={r} />
                </li>
              ))}
            </ul>
          </Card>
          <PageFooter
            pagination={{
              page: data.page,
              pageSize: data.pageSize,
              total: data.total,
              totalPages: Math.max(1, Math.ceil(data.total / data.pageSize)),
            }}
            onPageChange={setPage}
          />
        </>
      ) : data ? (
        <EmptyState
          icon={Search}
          title={t('noResults', { q })}
          description={t('noResultsHint')}
          className="py-16"
        />
      ) : null}
    </div>
  );
}

function ResultRow({ result: r }: { result: RankedSearchResultDTO }) {
  const t = useTranslations('search');
  const matched = r.matchedOn !== 'name' ? r.matchedOn : null;
  return (
    <Link
      href={r.link}
      className="hover:bg-surface-muted/60 focus-visible:bg-surface-muted/60 flex items-center gap-3 px-4 py-3 transition-colors focus-visible:outline-none"
    >
      <ResultImage result={r} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          <BidiText>{r.title}</BidiText>
        </p>
        {r.subtitle ? (
          <p className="text-muted-foreground truncate text-xs">
            <BidiText>{r.subtitle}</BidiText>
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-muted-foreground text-[11px]">{t(`type.${r.type}`)}</span>
        {matched ? <Badge tone="neutral">{t(`matchedOn.${matched}`)}</Badge> : null}
      </div>
    </Link>
  );
}

function ResultImage({ result: r }: { result: RankedSearchResultDTO }) {
  if (r.type === 'influencer') return <Avatar name={r.title} src={r.imageUrl} size="md" />;
  const Icon = r.type === 'campaign' ? Megaphone : r.type === 'brand' ? Store : PlaySquare;
  const fallback = (
    <span className="bg-surface-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
      <Icon className="text-muted-foreground h-4 w-4" aria-hidden />
    </span>
  );
  return r.imageUrl ? (
    <SafeImg
      src={r.imageUrl}
      alt=""
      className="h-10 w-10 shrink-0 rounded-lg object-cover"
      fallback={fallback}
    />
  ) : (
    fallback
  );
}
