import { getLocale, getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/request';
import { CalendarClock, Coins, Eye, Heart, PlaySquare, Repeat, ShieldCheck, ShoppingBag } from 'lucide-react';
import type { CreatorPerformanceDTO } from '@influenceos/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { LtrText } from '@/components/common/bidi-text';
import { formatCompact, formatCurrency, formatNumber, formatPercent, relativeTime } from '@/lib/format';

function Stat({ icon: Icon, label, value, hint }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold text-foreground">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

/**
 * A creator's results over time (P2.7): how their posts do (medians, so one
 * viral post doesn't flatter them), whether brands book them again, whether
 * they post on time, and — with finance access — what they cost per view.
 */
export async function CreatorPerformance({ performance: p }: { performance: CreatorPerformanceDTO }) {
  const t = await getTranslations('influencers');
  const tc = await getTranslations('common');
  const locale = (await getLocale()) as Locale;
  const na = tc('na');
  const pct = (n: number | null, digits = 0) => (n == null ? na : formatPercent(n, digits));

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t('detail.performance.title')}</CardTitle>
      </CardHeader>
      {p.posts === 0 && p.campaigns === 0 ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('detail.performance.empty')}</p>
        </CardContent>
      ) : (
        <>
          <CardContent className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              icon={PlaySquare}
              label={t('detail.performance.posts')}
              value={<LtrText>{formatNumber(p.posts)}</LtrText>}
              hint={t('detail.performance.last90Days', { value: formatNumber(p.postsLast90Days) })}
            />
            <Stat
              icon={Eye}
              label={t('detail.performance.medianViews')}
              value={<LtrText>{p.medianViews == null ? na : formatCompact(p.medianViews)}</LtrText>}
              hint={
                p.medianViewsLast90Days != null
                  ? t('detail.performance.last90Days', { value: formatCompact(p.medianViewsLast90Days) })
                  : p.totalViews != null
                    ? t('detail.performance.totalViews', { value: formatCompact(p.totalViews) })
                    : undefined
              }
            />
            <Stat icon={Heart} label={t('detail.performance.medianEngagement')} value={<LtrText>{pct(p.medianEngagementRate, 2)}</LtrText>} />
            <Stat
              icon={CalendarClock}
              label={t('detail.performance.lastPosted')}
              value={p.lastPostedAt ? relativeTime(p.lastPostedAt, locale) : t('detail.performance.never')}
            />
            <Stat
              icon={Repeat}
              label={t('detail.performance.rebooked')}
              value={<LtrText>{p.rebookRate == null ? na : formatPercent(p.rebookRate * 100, 0)}</LtrText>}
              hint={t('detail.performance.brandsCampaigns', { brands: p.brands, campaigns: p.campaigns })}
            />
            <Stat
              icon={ShieldCheck}
              label={t('detail.performance.onTime')}
              value={<LtrText>{p.onTimeRate == null ? na : formatPercent(p.onTimeRate * 100, 0)}</LtrText>}
              hint={p.averageDelayDays != null && p.averageDelayDays > 0 ? t('detail.performance.averageDelay', { days: p.averageDelayDays }) : undefined}
            />
            {p.paid !== null ? (
              <>
                <Stat
                  icon={Coins}
                  label={t('detail.performance.paid')}
                  value={<LtrText>{p.paid.length ? p.paid.map((x) => formatCurrency(x.amount, x.currency)).join(' · ') : formatCurrency(0)}</LtrText>}
                />
                <Stat
                  icon={Coins}
                  label={t('detail.performance.costPer1000Views')}
                  value={<LtrText>{p.costPerView ? formatCurrency(p.costPerView.value * 1000, p.costPerView.currency) : na}</LtrText>}
                />
              </>
            ) : null}
            {p.sales ? (
              <Stat
                icon={ShoppingBag}
                label={t('detail.performance.sales')}
                value={
                  <LtrText>
                    {p.sales.revenue.length ? p.sales.revenue.map((x) => formatCurrency(x.amount, x.currency)).join(' · ') : formatNumber(p.sales.orders)}
                  </LtrText>
                }
                hint={t('detail.performance.salesHint', { orders: p.sales.orders, clicks: p.sales.clicks })}
              />
            ) : null}
          </CardContent>
          {p.byPlatform.length > 0 ? (
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
              <span className="me-1 text-sm font-medium text-foreground">{t('detail.performance.byPlatform')}</span>
              {p.byPlatform.map((row) => (
                <span key={row.platform} className="inline-flex items-center gap-1.5 text-xs">
                  <PlatformBadge platform={row.platform} size="sm" />
                  <span className="text-muted-foreground">
                    {t('detail.performance.platformLine', {
                      posts: row.posts,
                      views: row.medianViews == null ? na : formatCompact(row.medianViews),
                    })}
                  </span>
                </span>
              ))}
            </CardContent>
          ) : null}
        </>
      )}
    </Card>
  );
}
