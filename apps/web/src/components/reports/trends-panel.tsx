'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { TrendBucket } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import type { TrendMetric } from './trends-chart';

// Recharts is heavy and only needed once this card is on screen.
const TrendsChart = dynamic(() => import('./trends-chart').then((m) => m.TrendsChart), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full rounded-2xl" />,
});

function Toggle<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-surface-muted p-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            value === o.key ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Week- or month-by-month results (P2.7): the last 12 of either, for
 * everything in scope, one brand, one campaign or one creator.
 */
export function TrendsPanel({
  brandId,
  campaignId,
  influencerId,
  title,
}: {
  brandId?: string;
  campaignId?: string;
  influencerId?: string;
  title?: string;
}) {
  const t = useTranslations('reports');
  const [bucket, setBucket] = React.useState<TrendBucket>('month');
  const [metric, setMetric] = React.useState<TrendMetric>('posts');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['trends', brandId ?? null, campaignId ?? null, influencerId ?? null, bucket],
    queryFn: () => api.reports.trends({ brandId, campaignId, influencerId, bucket }),
  });

  const showsMoney = Boolean(data && data.currencies.length > 0 && data.points.some((p) => p.paid !== null));
  const metrics: { key: TrendMetric; label: string }[] = [
    { key: 'posts', label: t('exec.trends.metrics.posts') },
    { key: 'views', label: t('exec.trends.metrics.views') },
    ...(showsMoney ? [{ key: 'paid' as const, label: t('exec.trends.metrics.paid') }] : []),
  ];
  const activeMetric = metric === 'paid' && !showsMoney ? 'posts' : metric;
  const empty = data ? data.points.every((p) => p.postsPublished === 0 && p.deliverablesDelivered === 0 && !p.paid?.length) : false;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>{title ?? t('exec.trends.title')}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle value={activeMetric} options={metrics} onChange={setMetric} />
          <Toggle
            value={bucket}
            options={[
              { key: 'week', label: t('exec.trends.weekly') },
              { key: 'month', label: t('exec.trends.monthly') },
            ]}
            onChange={setBucket}
          />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-64 w-full rounded-2xl" />
        ) : isError || !data ? (
          <EmptyState title={t('exec.trends.errorTitle')} description={t('exec.trends.errorDescription')} className="h-56 border-0 bg-transparent py-8" />
        ) : empty ? (
          <EmptyState title={t('exec.trends.emptyTitle')} description={t('exec.trends.emptyDescription')} className="h-56 border-0 bg-transparent py-8" />
        ) : (
          <TrendsChart data={data} metric={activeMetric} />
        )}
      </CardContent>
    </Card>
  );
}
