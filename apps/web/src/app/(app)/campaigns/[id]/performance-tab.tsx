'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Clock,
  DollarSign,
  Eye,
  Heart,
  Percent as PercentIcon,
  TrendingUp,
} from 'lucide-react';
import { EnterMetricsDialog } from '@/components/content/enter-metrics-dialog';
import { BulkMetricsDialog } from '@/components/content/bulk-metrics-dialog';
import type { CampaignEfficiencyDTO, CreatorEfficiencyDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { StatCard } from '@/components/ui/stat-card';
import { InfoTooltip } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableScroll,
} from '@/components/ui/table';
import { formatCompact, formatCurrency, formatPercent, useLocalizedFormat } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PageFooter } from '@/components/ui/page-footer';

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

function MetricTile({
  label,
  value,
  icon: Icon,
  tooltip,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tooltip: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground">
            {label} <InfoTooltip text={tooltip} />
          </span>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted-foreground">
            <Icon className="size-5" />
          </span>
        </div>
        <div className="text-3xl font-semibold tracking-tight text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Metric freshness + provenance banner (W6-1). Surfaces when the campaign's
 * metrics were last synced, whether they are stale, coverage, and where the
 * numbers came from — so an exec reads the efficiency figures with the right
 * amount of trust.
 */
function MetricsFreshnessBanner({ efficiency }: { efficiency: CampaignEfficiencyDTO }) {
  const t = useTranslations('campaigns');
  const tEnums = useTranslations('enums');
  const { relativeTime } = useLocalizedFormat();
  const synced = efficiency.metricsLastSyncedAt;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border bg-surface-muted/40 px-4 py-3 text-sm">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Clock className="size-4" />
        {synced
          ? t('workspace.performance.metricsSynced', { relative: relativeTime(synced) })
          : t('workspace.performance.metricsNeverSynced')}
      </span>
      <Badge tone={efficiency.isStale ? 'warning' : 'success'}>
        {efficiency.isStale ? (
          <span className="inline-flex items-center gap-1">
            <AlertCircle className="size-3.5" />{' '}
            {t('workspace.performance.staleLabel', { days: efficiency.freshnessWindowDays })}
          </span>
        ) : (
          t('workspace.performance.freshLabel')
        )}
      </Badge>
      <span className="text-muted-foreground">
        {t('workspace.performance.measuredCount', {
          measured: efficiency.contentWithMetrics,
          total: efficiency.contentCount,
        })}
      </span>
      {efficiency.sources.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {efficiency.sources.map((s) => (
            <Badge key={s.source} tone="neutral">
              {enumLabel(tEnums, 'dataSource', s.source)} · {s.count}
            </Badge>
          ))}
        </span>
      )}
    </div>
  );
}

type CreatorSortKey = 'postsLive' | 'views' | 'engagements' | 'engagementRate' | 'spend' | 'costPerView' | 'costPerEngagement';
/** Cost columns sort cheapest first on the first click; everything else biggest first. */
const CHEAPEST_FIRST: CreatorSortKey[] = ['costPerView', 'costPerEngagement'];

/**
 * Every creator on the roster side by side — their own posts, reach and cost
 * per view — so the one who delivered and the one who didn't are obvious.
 * Sort by any column; creators without a number sort last either way.
 */
function CreatorComparison({ rows, currency }: { rows: CreatorEfficiencyDTO[]; currency: string }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const [sort, setSort] = React.useState<{ key: CreatorSortKey; dir: 'asc' | 'desc' }>({ key: 'views', dir: 'desc' });
  const na = tCommon('na');

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    if (av == null && bv == null) return a.influencerName.localeCompare(b.influencerName);
    if (av == null) return 1;
    if (bv == null) return -1;
    return sort.dir === 'asc' ? av - bv : bv - av;
  });

  const columns: { key: CreatorSortKey; label: string; value: (r: CreatorEfficiencyDTO) => string; sentence?: boolean }[] = [
    {
      key: 'postsLive',
      sentence: true,
      label: t('workspace.performance.byCreator.posts'),
      value: (r) =>
        r.postsPlanned > 0
          ? t('workspace.influencers.results.postsOfPlanned', { live: r.postsLive, planned: r.postsPlanned })
          : String(r.postsLive),
    },
    { key: 'views', label: t('workspace.performance.viewsHeader'), value: (r) => (r.views != null ? formatCompact(r.views) : na) },
    {
      key: 'engagements',
      label: t('workspace.performance.engagementHeader'),
      value: (r) => (r.engagements != null ? formatCompact(r.engagements) : na),
    },
    {
      key: 'engagementRate',
      label: t('workspace.performance.engRateHeader'),
      value: (r) => (r.engagementRate != null ? formatPercent(r.engagementRate) : na),
    },
    { key: 'spend', label: t('workspace.performance.byCreator.spend'), value: (r) => formatCurrency(r.spend, currency) },
    {
      key: 'costPerView',
      label: t('workspace.performance.byCreator.costPerView'),
      value: (r) => (r.costPerView != null ? formatCurrency(r.costPerView, currency) : na),
    },
    {
      key: 'costPerEngagement',
      label: t('workspace.performance.byCreator.costPerEngagement'),
      value: (r) => (r.costPerEngagement != null ? formatCurrency(r.costPerEngagement, currency) : na),
    },
  ];

  function sortBy(key: CreatorSortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: CHEAPEST_FIRST.includes(key) ? 'asc' : 'desc' },
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="inline-flex items-center gap-1.5">
          {t('workspace.performance.byCreator.title')}
          <InfoTooltip text={t('workspace.performance.byCreator.tooltip')} />
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <TableScroll>
          <Table className="min-w-[860px]">
            <TableHead>
              <TableRow className="hover:bg-transparent">
                <TableHeaderCell>{t('operations.influencerHeader')}</TableHeaderCell>
                {columns.map((c) => {
                  const active = sort.key === c.key;
                  const Arrow = sort.dir === 'asc' ? ArrowUp : ArrowDown;
                  return (
                    <TableHeaderCell
                      key={c.key}
                      align="end"
                      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => sortBy(c.key)}
                        className={cn(
                          'inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground',
                          active && 'text-foreground',
                        )}
                      >
                        {c.label}
                        {active ? <Arrow className="h-3 w-3" /> : null}
                      </button>
                    </TableHeaderCell>
                  );
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.campaignInfluencerId}>
                  <TableCell>
                    <Link href={`/influencers/${r.influencerId}`} className="flex items-center gap-2 hover:underline">
                      <Avatar name={r.influencerName} src={r.influencerAvatarUrl} size="xs" />
                      <span className="max-w-[14rem] truncate font-medium">
                        <BidiText>{r.influencerName}</BidiText>
                      </span>
                    </Link>
                  </TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.key} align="end">
                      {c.sentence ? c.value(r) : <LtrText>{c.value(r)}</LtrText>}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      </CardContent>
    </Card>
  );
}

export function PerformanceTab({ campaignId }: { campaignId: string }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tContent = useTranslations('content');
  const { relativeTime } = useLocalizedFormat();
  // Efficiency (CPV/CPM/CPE + rollups + freshness) is computed server-side
  // (W6-1 / ARCH-01) — the browser renders these numbers, it never derives them.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-efficiency', campaignId],
    queryFn: () => api.campaigns.efficiency(campaignId),
  });
  // Every post in the campaign, a page at a time (the totals above cover them all).
  const [tablePage, setTablePage] = React.useState(1);
  const rowsQuery = useQuery({
    queryKey: ['campaign-content', campaignId, 'performance', tablePage],
    queryFn: () => api.campaigns.content(campaignId, { bucket: 'linked', page: tablePage, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-14 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={TrendingUp}
        title={t('workspace.performance.loadErrorTitle')}
        description={t('workspace.performance.loadErrorDescription')}
      />
    );
  }

  if (data.contentCount === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title={t('workspace.performance.emptyTitle')}
        description={t('workspace.performance.emptyDescription')}
      />
    );
  }

  const { currency } = data;
  const byContent = new Map(data.perContent.map((p) => [p.contentId, p]));

  return (
    <div className="space-y-6">
      <MetricsFreshnessBanner efficiency={data} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label={t('workspace.performance.totalViews')} value={data.totalViews} icon={Eye} tone="info" format={formatCompact} />
        <StatCard
          label={t('workspace.performance.totalEngagement')}
          value={data.totalEngagement}
          icon={Heart}
          tone="accent"
          format={formatCompact}
        />
        <MetricTile
          label={t('workspace.performance.avgEngagementRate')}
          value={<LtrText>{data.avgEngagementRate != null ? formatPercent(data.avgEngagementRate) : tCommon('na')}</LtrText>}
          icon={PercentIcon}
          tooltip={t('workspace.performance.avgEngagementRateTooltip')}
        />
        <MetricTile
          label={t('workspace.performance.costPerContent')}
          value={<LtrText>{data.costPerContent != null ? formatCurrency(data.costPerContent, currency) : tCommon('na')}</LtrText>}
          icon={DollarSign}
          tooltip={t('workspace.performance.costPerContentTooltip')}
        />
        <MetricTile
          label={t('workspace.performance.cpvLabel')}
          value={<LtrText>{data.costPerView != null ? formatCurrency(data.costPerView, currency) : tCommon('na')}</LtrText>}
          icon={Eye}
          tooltip={t('workspace.performance.cpvTooltip')}
        />
        <MetricTile
          label={t('workspace.performance.cpmLabel')}
          value={<LtrText>{data.costPerMille != null ? formatCurrency(data.costPerMille, currency) : tCommon('na')}</LtrText>}
          icon={TrendingUp}
          tooltip={t('workspace.performance.cpmTooltip')}
        />
        <MetricTile
          label={t('workspace.performance.cpeLabel')}
          value={<LtrText>{data.costPerEngagement != null ? formatCurrency(data.costPerEngagement, currency) : tCommon('na')}</LtrText>}
          icon={Heart}
          tooltip={t('workspace.performance.cpeTooltip')}
        />
      </div>

      {data.perCreator.length > 0 ? <CreatorComparison rows={data.perCreator} currency={currency} /> : null}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>{t('workspace.performance.contentPerformanceTitle')}</CardTitle>
          <BulkMetricsDialog campaignId={campaignId} />
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-start text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">{t('workspace.performance.contentHeader')}</th>
                <th className="px-5 py-3 font-medium">{t('fields.platform')}</th>
                <th className="px-5 py-3 font-medium">{t('workspace.performance.viewsHeader')}</th>
                <th className="px-5 py-3 font-medium">{t('workspace.performance.engagementHeader')}</th>
                <th className="px-5 py-3 font-medium">{t('workspace.performance.engRateHeader')}</th>
                <th className="px-5 py-3 font-medium">
                  <span className="inline-flex items-center gap-1">
                    {t('workspace.performance.estCpvHeader')}
                    <InfoTooltip text={t('workspace.performance.estCpvTooltip')} />
                  </span>
                </th>
                <th className="px-3 py-3" aria-label={tCommon('actions')} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(rowsQuery.data?.data ?? []).map((c) => {
                const eff = byContent.get(c.id);
                return (
                  <tr key={c.id}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={c.influencer?.displayName ?? tCommon('unknown')} src={c.influencer?.avatarUrl} size="xs" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {c.influencer?.displayName ? (
                              <BidiText>{c.influencer.displayName}</BidiText>
                            ) : (
                              tCommon('unassigned')
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{relativeTime(c.publishedAt ?? c.detectedAt)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <PlatformBadge platform={c.platform} size="sm" />
                    </td>
                    <td className="px-5 py-3 tabular-nums"><LtrText>{eff?.views != null ? formatCompact(eff.views) : tCommon('na')}</LtrText></td>
                    <td className="px-5 py-3 tabular-nums">
                      <LtrText>{eff?.totalEngagement != null ? formatCompact(eff.totalEngagement) : tCommon('na')}</LtrText>
                    </td>
                    <td className="px-5 py-3 tabular-nums">
                      <LtrText>{eff?.engagementRate != null ? formatPercent(eff.engagementRate) : tCommon('na')}</LtrText>
                    </td>
                    <td className="px-5 py-3 tabular-nums">
                      <LtrText>{eff?.costPerView != null ? formatCurrency(eff.costPerView, currency) : tCommon('na')}</LtrText>
                    </td>
                    <td className="px-3 py-3 text-end">
                      <EnterMetricsDialog
                        content={c}
                        trigger={
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={tContent('metricsEntry.open')}>
                            <BarChart3 className="h-4 w-4" />
                          </Button>
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
        <PageFooter pagination={rowsQuery.data?.pagination} onPageChange={setTablePage} className="px-5 pb-4" />
      </Card>
    </div>
  );
}
