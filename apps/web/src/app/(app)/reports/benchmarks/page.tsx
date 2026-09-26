import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Scale } from 'lucide-react';
import type {
  BenchmarkDTO,
  BenchmarkSpreadDTO,
  BenchmarkStatsDTO,
  FollowerTier,
  Platform,
} from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import {
  BENCHMARK_MONTHS,
  COUNTRY_CODES,
  FOLLOWER_TIERS,
  PLATFORMS,
  PLATFORM_META,
} from '@influenceos/shared';
import type { Locale } from '@/i18n/request';
import { getServerApi } from '@/lib/api-server';
import { cn } from '@/lib/cn';
import { enumLabel } from '@/lib/enum-labels';
import { formatNumber, formatPercent, shortDate } from '@/lib/format';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PlatformBadge } from '@/components/ui/platform-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableScroll,
} from '@/components/ui/table';
import {
  formatBenchmarkMoney,
  formatBenchmarkRate,
} from '@/components/benchmarks/benchmark-format';
import { BenchmarkControls } from './benchmark-controls';

export const dynamic = 'force-dynamic';

type Stat = 'feePerPost' | 'costPerView' | 'engagementRate';

/**
 * Rate benchmarks (P3.7): what creators like these were paid in the agency's
 * own confirmed paid bookings — by the platform and follower size they had
 * when booked — for one currency, period and creator country. The server
 * computes everything (and leaves out fee figures without finance access).
 */
export default async function BenchmarksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const currency = /^[A-Za-z]{3}$/.test(sp.currency ?? '') ? sp.currency!.toUpperCase() : 'KWD';
  const monthsRaw = Number(sp.months);
  const months = (BENCHMARK_MONTHS as readonly number[]).includes(monthsRaw) ? monthsRaw : 12;
  const countryCode = (COUNTRY_CODES as readonly string[]).includes(sp.countryCode ?? '')
    ? sp.countryCode!
    : '';
  const platform = (PLATFORMS as readonly string[]).includes(sp.platform ?? '')
    ? (sp.platform as Platform)
    : undefined;
  const tier = (FOLLOWER_TIERS as readonly string[]).includes(sp.tier ?? '')
    ? (sp.tier as FollowerTier)
    : undefined;

  const t = await getTranslations('reports.benchmarks');
  const te = await getTranslations('enums');
  const locale = (await getLocale()) as Locale;
  let b: BenchmarkDTO;
  try {
    b = await getServerApi().reports.benchmarks({
      currency,
      months,
      countryCode: countryCode || undefined,
      platform,
      tier,
    });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 422)) notFound();
    throw e;
  }

  const tierLabel = (x: FollowerTier) => enumLabel(te, 'followerTier', x);
  const currencies = [...new Set([b.currency, 'KWD', ...b.otherCurrencies.map((c) => c.currency)])];
  const period = b.since
    ? t('basisPeriod.since', { date: shortDate(b.since, locale) })
    : t('basisPeriod.all');
  const selection =
    platform && tier
      ? t('selection.some', { platform: PLATFORM_META[platform].label, tier: tierLabel(tier) })
      : platform
        ? t('selection.platformOnly', { platform: PLATFORM_META[platform].label })
        : tier
          ? t('selection.tierOnly', { tier: tierLabel(tier) })
          : t('selection.all');

  const show = (stat: Stat, v: number) =>
    stat === 'feePerPost'
      ? formatBenchmarkMoney(v, b.currency)
      : stat === 'costPerView'
        ? formatBenchmarkRate(v, b.currency)
        : formatPercent(v, 1, locale);
  const moneyStat = (stat: Stat) => stat !== 'engagementRate';

  function statCell(stats: BenchmarkStatsDTO, stat: Stat) {
    const s: BenchmarkSpreadDTO | null = stats[stat];
    if (!s) {
      if (moneyStat(stat) && !b.moneyVisible)
        return <span className="text-muted-foreground">—</span>;
      return (
        <span
          className="text-muted-foreground text-xs"
          title={t('grid.notEnough', { min: b.minSample })}
        >
          —
        </span>
      );
    }
    return (
      <div className="leading-tight">
        <bdi dir="ltr" className="font-medium tabular-nums">
          {show(stat, s.median)}
        </bdi>
        <div className="text-muted-foreground text-[11px] tabular-nums">
          <bdi dir="ltr">
            {show(stat, s.p25)} – {show(stat, s.p75)}
          </bdi>
        </div>
      </div>
    );
  }

  const summaryTiles: { stat: Stat; label: string }[] = [
    { stat: 'feePerPost', label: t('stats.feePerPost') },
    { stat: 'costPerView', label: t('stats.costPerView') },
    { stat: 'engagementRate', label: t('stats.engagementRate') },
  ];
  const platforms = PLATFORMS.filter((p) => b.grid.some((c) => c.platform === p));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/reports">
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
              {t('back')}
            </Link>
          </Button>
        }
      />

      <BenchmarkControls
        state={{
          currency: b.currency,
          months: b.months,
          countryCode,
          platform: platform ?? '',
          tier: tier ?? '',
        }}
        currencies={currencies}
      />

      <div className="text-muted-foreground space-y-1 text-xs">
        <p>{t('basis', { currency: b.currency, period, min: b.minSample })}</p>
        {b.otherCurrencies.length > 0 ? (
          <p>
            {t('otherCurrencies', {
              count: b.otherCurrencies.reduce((n, c) => n + c.bookings, 0),
              list: b.otherCurrencies.map((c) => c.currency).join('، '),
            })}
          </p>
        ) : null}
        {!b.moneyVisible ? (
          <p className="text-amber-700 dark:text-amber-400">{t('moneyHidden')}</p>
        ) : null}
      </div>

      <section aria-labelledby="benchmark-summary" className="space-y-2">
        <h2 id="benchmark-summary" className="text-base font-semibold">
          {selection}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card>
            <CardContent className="space-y-1 p-4">
              <p className="text-muted-foreground text-xs">{t('stats.bookings')}</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatNumber(b.overall.bookings, locale)}
              </p>
            </CardContent>
          </Card>
          {summaryTiles.map(({ stat, label }) => {
            const s = b.overall[stat];
            return (
              <Card key={stat} data-testid={`benchmark-${stat}`}>
                <CardContent className="space-y-1 p-4">
                  <p className="text-muted-foreground text-xs">{label}</p>
                  {s ? (
                    <>
                      <p className="text-2xl font-semibold tabular-nums">
                        <bdi dir="ltr">{show(stat, s.median)}</bdi>
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t.rich('stats.middleHalf', {
                          from: show(stat, s.p25),
                          to: show(stat, s.p75),
                          r: (chunks) => (
                            <bdi dir="ltr" className="whitespace-nowrap">
                              {chunks}
                            </bdi>
                          ),
                        })}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t('stats.basedOn', { count: s.sampleSize })}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground pt-1 text-sm">
                      {moneyStat(stat) && !b.moneyVisible ? '—' : t('stats.notEnough')}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="benchmark-grid" className="space-y-3">
        <h2 id="benchmark-grid" className="text-base font-semibold">
          {t('grid.title')}
        </h2>
        {platforms.length === 0 ? (
          <EmptyState icon={Scale} title={t('empty.title')} description={t('empty.description')} />
        ) : (
          <div className="grid gap-4">
            {platforms.map((p) => (
              <Card key={p} role="region" aria-label={PLATFORM_META[p].label}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <PlatformBadge platform={p} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <TableScroll>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableHeaderCell>{t('grid.tier')}</TableHeaderCell>
                          <TableHeaderCell className="text-end">
                            {t('grid.bookings')}
                          </TableHeaderCell>
                          <TableHeaderCell>{t('grid.feePerPost')}</TableHeaderCell>
                          <TableHeaderCell>{t('grid.costPerView')}</TableHeaderCell>
                          <TableHeaderCell>{t('grid.engagementRate')}</TableHeaderCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {FOLLOWER_TIERS.map((x) => {
                          const cell = b.grid.find((c) => c.platform === p && c.tier === x);
                          if (!cell) return null;
                          const selected =
                            (!platform || platform === p) &&
                            (!tier || tier === x) &&
                            Boolean(platform || tier);
                          return (
                            <TableRow
                              key={x}
                              aria-current={selected ? 'true' : undefined}
                              className={cn(selected && 'bg-brand/5')}
                            >
                              <TableCell className="whitespace-nowrap font-medium">
                                {tierLabel(x)}
                              </TableCell>
                              <TableCell className="text-end tabular-nums">
                                {formatNumber(cell.bookings, locale)}
                              </TableCell>
                              <TableCell>{statCell(cell, 'feePerPost')}</TableCell>
                              <TableCell>{statCell(cell, 'costPerView')}</TableCell>
                              <TableCell>{statCell(cell, 'engagementRate')}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableScroll>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
