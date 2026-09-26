import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/request';
import { BarChart3, CalendarClock, TrendingUp, Trophy } from 'lucide-react';
import type { CreatorTier, ExecDashboardDTO, CreatorLeaderboardDTO, BrandSummaryDTO, ReportPeriod, Tone } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { percentChange, REPORT_PERIODS } from '@influenceos/shared';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { formatCompact, formatCurrency, formatNumber, formatPercent, relativeTime, shortDate } from '@/lib/format';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { ExecControls } from './exec-controls';
import { TrendsPanel } from '@/components/reports/trends-panel';

export const dynamic = 'force-dynamic';

const TIER_TONE: Record<CreatorTier, Tone> = { GOLD: 'warning', SILVER: 'info', BRONZE: 'accent', NEW: 'neutral' };

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Executive dashboard (W6-3 + W6-2, periods and trends P2.7): results for a
 *  period against the one before it, week/month trends, spend vs budget,
 *  today, since-yesterday, the cross-brand rollup and the creator leaderboard
 *  — all server-computed, this page only renders. */
export default async function ExecPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const period: ReportPeriod = (REPORT_PERIODS as readonly string[]).includes(sp.period ?? '') ? (sp.period as ReportPeriod) : 'month';
  const brandId = sp.brandId || undefined;
  const from = period === 'custom' && DAY_KEY.test(sp.from ?? '') ? sp.from : undefined;
  const to = period === 'custom' && DAY_KEY.test(sp.to ?? '') ? sp.to : undefined;

  const t = await getTranslations('reports');
  const tCommon = await getTranslations('common');
  const locale = (await getLocale()) as Locale;
  const api = getServerApi();
  let dash: ExecDashboardDTO;
  let board: CreatorLeaderboardDTO;
  let brands: BrandSummaryDTO[];
  try {
    [dash, board, brands] = await Promise.all([
      api.reports.execDashboard({ brandId, period, from, to }),
      api.reports.leaderboard({ limit: 10, brandId }),
      api.brands.list(),
    ]);
  } catch (e) {
    // A brand that isn't there (or isn't yours) in the address.
    if (e instanceof ApiError && (e.status === 404 || e.status === 422)) notFound();
    throw e;
  }
  const c = dash.currency;
  const money = (n: number, currency = c) => formatCurrency(n, currency);
  const day = (key: string) => shortDate(key, locale);

  const cur = dash.period.current;
  const prev = dash.period.previous;
  const vs = t('exec.results.vsPrevious');
  const trend = (a: number | null, b: number | null, invert = false) => {
    const value = percentChange(a, b);
    return value == null ? undefined : { value, label: vs, invert };
  };
  const was = (text: string) => t('exec.results.previously', { value: text });
  const pct = (n: number | null, digits = 1) => (n == null ? tCommon('na') : formatPercent(n, digits));
  const mainPaid = cur.paid?.[0] ?? null;
  const prevPaid = mainPaid ? (prev.paid?.find((x) => x.currency === mainPaid.currency)?.amount ?? 0) : null;
  const otherPaid = cur.paid && cur.paid.length > 1 ? cur.paid.slice(1).map((x) => money(x.amount, x.currency)).join(' · ') : undefined;
  const cpm = (v: { currency: string; value: number } | null) => (v ? money(v.value * 1000, v.currency) : tCommon('na'));
  const sameCpmCurrency = cur.costPerView && prev.costPerView && cur.costPerView.currency === prev.costPerView.currency;

  return (
    <div className="space-y-8">
      <PageHeader title={t('exec.title')} description={t('exec.description')} />

      <ExecControls brands={brands} period={period} brandId={brandId} from={dash.period.from} to={dash.period.to} />

      {/* Results this period vs the one before (P2.7) */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <BarChart3 className="size-5 text-muted-foreground" aria-hidden /> {t('exec.results.title')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('exec.results.range', {
              from: day(dash.period.from),
              to: day(dash.period.to),
              previousFrom: day(dash.period.previousFrom),
              previousTo: day(dash.period.previousTo),
            })}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label={t('exec.results.postsPublished')}
            value={cur.postsPublished}
            iconName="content"
            tone="info"
            formatted={formatNumber(cur.postsPublished)}
            trend={trend(cur.postsPublished, prev.postsPublished)}
            hint={t('exec.results.activeCreators', { count: cur.activeCreators })}
          />
          <StatCard
            label={t('exec.results.views')}
            value={cur.views}
            iconName="trending"
            tone="accent"
            formatted={cur.views == null ? tCommon('na') : formatCompact(cur.views)}
            trend={trend(cur.views, prev.views)}
          />
          <StatCard
            label={t('exec.results.engagementRate')}
            value={cur.engagementRate}
            iconName="users"
            tone="success"
            formatted={pct(cur.engagementRate, 2)}
            hint={was(pct(prev.engagementRate, 2))}
          />
          <StatCard
            label={t('exec.results.deliverablesDelivered')}
            value={cur.deliverablesDelivered}
            iconName="deliverables"
            tone="neutral"
            formatted={formatNumber(cur.deliverablesDelivered)}
            trend={trend(cur.deliverablesDelivered, prev.deliverablesDelivered)}
          />
          <StatCard
            label={t('exec.results.onTimeRate')}
            value={cur.onTimeRate}
            iconName="deliverables"
            tone={cur.onTimeRate == null ? 'neutral' : cur.onTimeRate >= 0.8 ? 'success' : cur.onTimeRate >= 0.5 ? 'warning' : 'danger'}
            formatted={cur.onTimeRate == null ? tCommon('na') : formatPercent(cur.onTimeRate * 100, 0)}
            hint={was(prev.onTimeRate == null ? tCommon('na') : formatPercent(prev.onTimeRate * 100, 0))}
          />
          <StatCard
            label={t('exec.results.campaignsStarted')}
            value={cur.campaignsStarted}
            iconName="megaphone"
            tone="neutral"
            formatted={formatNumber(cur.campaignsStarted)}
            hint={was(formatNumber(prev.campaignsStarted))}
          />
          {cur.paid !== null ? (
            <>
              <StatCard
                label={t('exec.results.paid')}
                value={mainPaid?.amount ?? 0}
                iconName="wallet"
                tone="warning"
                formatted={mainPaid ? money(mainPaid.amount, mainPaid.currency) : money(0)}
                trend={mainPaid ? trend(mainPaid.amount, prevPaid) : undefined}
                hint={otherPaid ? t('exec.results.alsoPaid', { amounts: otherPaid }) : undefined}
              />
              <StatCard
                label={t('exec.results.costPer1000Views')}
                value={cur.costPerView?.value ?? null}
                iconName="wallet"
                tone="neutral"
                formatted={cpm(cur.costPerView)}
                trend={sameCpmCurrency ? trend(cur.costPerView!.value, prev.costPerView!.value, true) : undefined}
                hint={cur.costPerView ? undefined : t('exec.results.costPerViewHint')}
              />
            </>
          ) : null}
        </div>
      </section>

      <TrendsPanel brandId={brandId} />

      {/* Spend vs budget */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">{t('exec.spendVsBudget.title')}</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard
            label={t('exec.spendVsBudget.plannedBudget')}
            value={dash.spendVsBudget.plannedBudget}
            iconName="wallet"
            tone="neutral"
            formatted={money(dash.spendVsBudget.plannedBudget)}
          />
          <StatCard
            label={t('exec.spendVsBudget.totalSpend')}
            value={dash.spendVsBudget.totalSpend}
            iconName="wallet"
            tone="info"
            formatted={money(dash.spendVsBudget.totalSpend)}
          />
          <StatCard
            label={t('exec.spendVsBudget.remaining')}
            value={dash.spendVsBudget.remaining}
            iconName="wallet"
            tone={dash.spendVsBudget.remaining < 0 ? 'danger' : 'success'}
            formatted={money(dash.spendVsBudget.remaining)}
          />
          <StatCard
            label={t('exec.spendVsBudget.budgetUsed')}
            value={dash.spendVsBudget.budgetUsedPercent ?? 0}
            iconName="trending"
            tone={(dash.spendVsBudget.budgetUsedPercent ?? 0) > 100 ? 'danger' : 'accent'}
            formatted={dash.spendVsBudget.budgetUsedPercent == null ? tCommon('na') : `${dash.spendVsBudget.budgetUsedPercent}%`}
          />
          <StatCard
            label={t('exec.spendVsBudget.unpaidSpend')}
            value={dash.spendVsBudget.unpaidSpend}
            iconName="wallet"
            tone={dash.spendVsBudget.unpaidSpend > 0 ? 'warning' : 'success'}
            formatted={money(dash.spendVsBudget.unpaidSpend)}
          />
        </div>
        {dash.spendVsBudget.campaignsOverBudget > 0 ? (
          <p className="text-sm text-danger">
            {t('exec.spendVsBudget.campaignsOverBudget', { count: dash.spendVsBudget.campaignsOverBudget })}
          </p>
        ) : null}
        {dash.spendVsBudget.mixed ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('exec.spendVsBudget.mixedNote', { currency: c })}</p>
            <Card className="overflow-hidden">
              <TableScroll>
                <Table className="min-w-[640px]">
                  <TableHead>
                    <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                      <TableHeaderCell className="ps-5">{t('exec.spendVsBudget.currency')}</TableHeaderCell>
                      <TableHeaderCell align="end">{t('exec.spendVsBudget.plannedBudget')}</TableHeaderCell>
                      <TableHeaderCell align="end">{t('exec.spendVsBudget.totalSpend')}</TableHeaderCell>
                      <TableHeaderCell align="end">{t('exec.spendVsBudget.remaining')}</TableHeaderCell>
                      <TableHeaderCell align="end">{t('exec.spendVsBudget.budgetUsed')}</TableHeaderCell>
                      <TableHeaderCell align="end">{t('exec.spendVsBudget.unpaidSpend')}</TableHeaderCell>
                      <TableHeaderCell align="end">{t('exec.spendVsBudget.campaigns')}</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dash.spendVsBudget.byCurrency.map((l) => (
                      <TableRow key={l.currency}>
                        <TableCell className="ps-5 font-medium"><LtrText>{l.currency}</LtrText></TableCell>
                        <TableCell align="end"><LtrText>{money(l.plannedBudget, l.currency)}</LtrText></TableCell>
                        <TableCell align="end"><LtrText>{money(l.totalSpend, l.currency)}</LtrText></TableCell>
                        <TableCell align="end" className={l.remaining < 0 ? 'text-danger' : undefined}>
                          <LtrText>{money(l.remaining, l.currency)}</LtrText>
                        </TableCell>
                        <TableCell align="end">{l.budgetUsedPercent == null ? '—' : <LtrText>{`${l.budgetUsedPercent}%`}</LtrText>}</TableCell>
                        <TableCell align="end"><LtrText>{money(l.unpaidSpend, l.currency)}</LtrText></TableCell>
                        <TableCell align="end">{l.campaigns}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScroll>
            </Card>
          </div>
        ) : null}
      </section>

      {/* Today + since-yesterday */}
      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <CalendarClock className="size-5 text-muted-foreground" aria-hidden />
            <CardTitle>{tCommon('today')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Metric label={t('exec.today.contentPublished')} value={dash.today.contentPublished} href="/content?today=1" />
            <Metric label={t('exec.today.deliverablesDue')} value={dash.today.deliverablesDue} href="/calendar" />
            <Metric label={t('exec.today.campaignsStarting')} value={dash.today.campaignsStarting} href="/campaigns" />
            <Metric label={t('exec.today.campaignsEnding')} value={dash.today.campaignsEnding} href="/campaigns" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('exec.sinceYesterday.title')}</CardTitle>
            <span className="text-xs text-muted-foreground">{relativeTime(dash.digest.since, locale)}</span>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Metric label={t('exec.sinceYesterday.contentPublished')} value={dash.digest.contentPublished} href="/content" />
            <Metric label={t('exec.sinceYesterday.deliverablesCompleted')} value={dash.digest.deliverablesCompleted} href="/calendar" />
            <Metric label={t('exec.sinceYesterday.campaignsCreated')} value={dash.digest.campaignsCreated} href="/campaigns" />
            <Metric label={t('exec.sinceYesterday.campaignsCompleted')} value={dash.digest.campaignsCompleted} href="/campaigns" />
            <Metric label={t('exec.sinceYesterday.rosterAdditions')} value={dash.digest.rosterAdditions} href="/influencers" />
            <Metric
              label={t('exec.sinceYesterday.contentRemoved')}
              value={dash.digest.contentRemoved}
              tone={dash.digest.contentRemoved > 0 ? 'danger' : undefined}
              href="/content?alerts=1"
            />
            <Metric label={t('exec.sinceYesterday.shipmentsDelivered')} value={dash.digest.shipmentsDelivered} href="/logistics?status=DELIVERED" />
            <Metric
              label={t('exec.sinceYesterday.shipmentsFailed')}
              value={dash.digest.shipmentsFailed}
              tone={dash.digest.shipmentsFailed > 0 ? 'danger' : undefined}
              href="/logistics?status=FAILED"
            />
            <Metric
              label={t('exec.sinceYesterday.ugcAwaitingReview')}
              value={dash.digest.ugcAwaitingReview}
              tone={dash.digest.ugcAwaitingReview > 0 ? 'danger' : undefined}
              href="/"
            />
          </CardContent>
        </Card>
      </section>

      {/* Cross-brand rollup */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">{t('exec.brands.title')}</h2>
        {dash.brands.length === 0 ? (
          <EmptyState icon={TrendingUp} title={t('exec.brands.emptyTitle')} description={t('exec.brands.emptyDescription')} />
        ) : (
          <Card className="overflow-hidden">
            <TableScroll>
              <Table className="min-w-[720px]">
                <TableHead>
                  <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                    <TableHeaderCell className="ps-5">{t('exec.brands.columns.brand')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.brands.columns.active')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.brands.columns.spend')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.brands.columns.budget')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.brands.columns.used')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.brands.columns.overdue')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.brands.columns.alerts')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.brands.columns.issues')}</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dash.brands.map((b) => (
                    <TableRow key={b.brandId}>
                      <TableCell className="ps-5 font-medium">
                        <BidiText>{b.brandName}</BidiText>
                        {b.overBudget ? (
                          <Badge tone="danger" className="ms-2">
                            {t('exec.brands.overBudget')}
                          </Badge>
                        ) : null}
                        {b.mixed ? (
                          <Badge tone="neutral" className="ms-2" title={t('exec.brands.mixedHint', { currency: b.currency })}>
                            {t('exec.brands.mixed')}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell align="end">{b.activeCampaigns}</TableCell>
                      <TableCell align="end"><LtrText>{money(b.totalSpend, b.currency)}</LtrText></TableCell>
                      <TableCell align="end"><LtrText>{money(b.plannedBudget, b.currency)}</LtrText></TableCell>
                      <TableCell align="end">{b.budgetUsedPercent == null ? '—' : `${b.budgetUsedPercent}%`}</TableCell>
                      <TableCell align="end">{b.overdueDeliverables}</TableCell>
                      <TableCell align="end">{b.contentAlerts}</TableCell>
                      <TableCell align="end">
                        {b.issueCount > 0 ? <Badge tone="warning">{b.issueCount}</Badge> : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          </Card>
        )}
      </section>

      {/* Creator leaderboard */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Trophy className="size-5 text-muted-foreground" aria-hidden /> {t('exec.leaderboard.title')}
        </h2>
        <p className="-mt-2 text-sm text-muted-foreground">{t('exec.leaderboard.scoreHint')}</p>
        {board.entries.length === 0 ? (
          <EmptyState icon={Trophy} title={t('exec.leaderboard.emptyTitle')} description={t('exec.leaderboard.emptyDescription')} />
        ) : (
          <Card className="overflow-hidden">
            <TableScroll>
              <Table className="min-w-[880px]">
                <TableHead>
                  <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                    <TableHeaderCell className="ps-5">{t('exec.leaderboard.columns.creator')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.leaderboard.columns.campaigns')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.leaderboard.columns.published')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.leaderboard.columns.medianViews')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.leaderboard.columns.engagement')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.leaderboard.columns.onTime')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.leaderboard.columns.completion')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.leaderboard.columns.tier')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('exec.leaderboard.columns.score')}</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {board.entries.map((e, i) => (
                    <TableRow key={e.influencerId}>
                      <TableCell className="ps-5">
                        <div className="flex items-center gap-2.5">
                          <span className="w-5 text-end text-sm tabular-nums text-muted-foreground">{i + 1}</span>
                          <Avatar name={e.displayName} src={e.avatarUrl ?? undefined} size="xs" />
                          <div className="min-w-0">
                            <BidiText as="p" className="truncate font-medium">
                              {e.displayName}
                            </BidiText>
                            {e.primaryUsername ? (
                              <LtrText as="p" className="truncate text-xs text-muted-foreground">
                                @{e.primaryUsername}
                              </LtrText>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell align="end">{e.campaigns}</TableCell>
                      <TableCell align="end">
                        <LtrText>{formatCompact(e.deliverablesPublished)}</LtrText>
                      </TableCell>
                      <TableCell align="end">{e.medianViews == null ? '—' : <LtrText>{formatCompact(e.medianViews)}</LtrText>}</TableCell>
                      <TableCell align="end">
                        {e.medianEngagementRate == null ? '—' : <LtrText>{formatPercent(e.medianEngagementRate, 2)}</LtrText>}
                      </TableCell>
                      <TableCell align="end">{e.onTimeRate == null ? '—' : <LtrText>{formatPercent(e.onTimeRate * 100, 0)}</LtrText>}</TableCell>
                      <TableCell align="end">
                        {e.completionRate == null ? '—' : <LtrText>{formatPercent(e.completionRate * 100)}</LtrText>}
                      </TableCell>
                      <TableCell align="end">
                        <Badge tone={TIER_TONE[e.tier]}>{t(`exec.leaderboard.tier.${e.tier}`)}</Badge>
                      </TableCell>
                      <TableCell align="end" className="font-semibold">
                        {e.score}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          </Card>
        )}
      </section>

      <p className="text-xs text-muted-foreground">{t('exec.generatedAt', { time: relativeTime(dash.generatedAt, locale) })}</p>
    </div>
  );
}

function Metric({ label, value, tone, href }: { label: string; value: number; tone?: 'danger'; href?: string }) {
  const body = (
    <>
      <p className={`text-2xl font-semibold tabular-nums ${tone === 'danger' ? 'text-danger' : 'text-foreground'}`}>
        <LtrText>{formatCompact(value)}</LtrText>
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="-m-1.5 rounded-lg p-1.5 transition-colors hover:bg-surface-muted">
        {body}
      </Link>
    );
  }
  return <div>{body}</div>;
}
