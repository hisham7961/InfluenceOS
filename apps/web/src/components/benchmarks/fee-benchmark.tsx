'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Scale } from 'lucide-react';
import { PLATFORM_META } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { enumLabel } from '@/lib/enum-labels';
import { qk } from '@/lib/query-keys';
import { useApp } from '@/components/shell/app-context';
import { formatBenchmarkMoney } from './benchmark-format';

/**
 * "What do creators like this usually cost?" (P3.7) — beside a fee being
 * entered: the median fee per post and the middle half of past confirmed
 * bookings on the same platform and follower tier, and whether the fee typed
 * sits inside that range. Only for people who may see money.
 */
export function FeeBenchmark({
  campaignInfluencerId,
  influencerId,
  currency,
  fee,
  postsPlanned,
  className,
}: {
  /** A roster row: its platform and size when booked (and it is left out of its own figures). */
  campaignInfluencerId?: string;
  /** A creator not yet booked: their main account now. */
  influencerId?: string;
  currency: string;
  /** The fee being typed, to compare (per post when `postsPlanned` is known). */
  fee?: number | null;
  postsPlanned?: number;
  className?: string;
}) {
  const t = useTranslations('reports.benchmarks.hint');
  const te = useTranslations('enums');
  const { can } = useApp();
  const allowed = can('FINANCE_VIEW') && Boolean(campaignInfluencerId || influencerId);
  const params = { campaignInfluencerId, influencerId, currency, months: 12 };
  const query = useQuery({
    queryKey: qk.benchmarks(params),
    queryFn: () => api.reports.benchmarks(params),
    enabled: allowed,
    staleTime: 60_000,
  });
  if (!allowed) return null;

  const box = (children: React.ReactNode) => (
    <div
      className={cn(
        'bg-muted/40 text-muted-foreground flex gap-2 rounded-md border p-2.5 text-xs',
        className,
      )}
      data-testid="fee-benchmark"
    >
      <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );

  if (query.isLoading) return box(<p>{t('loading')}</p>);
  const b = query.data;
  if (!b) return null;
  if (!b.platform || !b.tier) return box(<p>{t('noAccount')}</p>);

  const who = t('who', {
    platform: PLATFORM_META[b.platform].label,
    tier: enumLabel(te, 'followerTier', b.tier),
  });
  const spread = b.overall.feePerPost;
  const money = (v: number) => formatBenchmarkMoney(v, b.currency);
  const href = `/reports/benchmarks?platform=${b.platform}&tier=${b.tier}&currency=${b.currency}`;

  if (!spread) {
    return box(
      <>
        <p>{t('notEnough', { who, count: b.overall.bookings, min: b.minSample })}</p>
        <Link href={href} className="text-brand font-medium hover:underline">
          {t('seeAll')}
        </Link>
      </>,
    );
  }

  const perPost = fee != null && fee > 0 ? fee / Math.max(1, postsPlanned ?? 1) : null;
  const verdict =
    perPost == null
      ? null
      : perPost > spread.p75
        ? 'above'
        : perPost < spread.p25
          ? 'below'
          : 'within';

  return box(
    <>
      <p>
        {t.rich('summary', {
          who,
          median: money(spread.median),
          from: money(spread.p25),
          to: money(spread.p75),
          count: spread.sampleSize,
          b: (chunks) => (
            <strong className="text-foreground font-semibold">
              <bdi dir="ltr">{chunks}</bdi>
            </strong>
          ),
          r: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
        })}
      </p>
      {verdict ? (
        <p
          className={cn(
            'font-medium',
            verdict === 'within'
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-amber-700 dark:text-amber-400',
          )}
        >
          {t(`verdict.${verdict}`, { fee: money(perPost!), posts: postsPlanned ?? 0 })}
        </p>
      ) : null}
      <Link href={href} className="text-brand font-medium hover:underline">
        {t('seeAll')}
      </Link>
    </>,
  );
}
