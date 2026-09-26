import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ExternalLink } from 'lucide-react';
import type { CampaignReportDTO, ReportTargetDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { getServerApi } from '@/lib/api-server';
import { formatCurrency, formatNumber, shortDate } from '@/lib/format';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { SafeImg } from '@/components/ui/safe-img';
import { cn } from '@/lib/cn';
import { ReportToolbar } from './report-toolbar';

export const dynamic = 'force-dynamic';

type T = Awaited<ReturnType<typeof getTranslations<'campaigns.clientReport'>>>;

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);
const num = (v: number | null) => (v == null ? '—' : formatNumber(v));

/** Money with enough decimals for a cost per view (fils, not whole dinars). */
function rate(v: number | null, currency: string): string {
  if (v == null) return '—';
  return `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 })}`;
}

/**
 * The campaign's client report (P2.2): what was promised against what was
 * delivered, per creator and per post, in the language the brand reads
 * (independent of the viewer's own). Prints cleanly to PDF from the browser
 * (the app's menus hide themselves when printing); the same figures download
 * as an Excel workbook.
 */
export default async function CampaignReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string; costs?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const api = getServerApi();
  let report: CampaignReportDTO;
  try {
    report = await api.campaigns.report(id, {
      locale: sp.lang === 'ar' || sp.lang === 'en' ? sp.lang : undefined,
      costs: sp.costs === '0' ? false : undefined,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const locale = report.locale;
  const t = await getTranslations({ locale, namespace: 'campaigns.clientReport' });
  const { campaign: c, totals } = report;
  const currency = c.currency;
  const topPosts = report.posts.filter((p) => p.views != null).slice(0, 3);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ReportToolbar
        campaignId={c.id}
        locale={locale}
        costsRequested={sp.costs !== '0'}
        includeCosts={report.includeCosts}
      />

      <article
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
        lang={locale}
        className="border-border bg-card shadow-card space-y-8 rounded-2xl border p-6 sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        {/* Header */}
        <header className="border-border flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
              {t('title')}
            </p>
            <h1 className="break-words text-2xl font-bold sm:text-3xl">
              <BidiText>{c.name}</BidiText>
            </h1>
            <p className="text-muted-foreground text-sm">
              {t('preparedFor', { brand: c.brandName })}
              {c.startDate || c.endDate ? (
                <>
                  {' · '}
                  <LtrText>
                    {[
                      c.startDate ? shortDate(c.startDate, locale) : null,
                      c.endDate ? shortDate(c.endDate, locale) : null,
                    ]
                      .filter(Boolean)
                      .join(' – ')}
                  </LtrText>
                </>
              ) : null}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('generatedOn', { date: shortDate(report.generatedAt, locale) })}
            </p>
          </div>
          {c.brandLogoUrl ? (
            <SafeImg
              src={c.brandLogoUrl}
              alt={c.brandName}
              className="h-14 w-auto max-w-[10rem] shrink-0 object-contain"
            />
          ) : null}
        </header>

        {report.summary ? (
          <section className="break-inside-avoid space-y-2">
            <h2 className="text-lg font-semibold">{t('summaryTitle')}</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed" dir="auto">
              {report.summary}
            </p>
          </section>
        ) : null}

        {/* Results against targets */}
        <section className="break-inside-avoid space-y-3">
          <h2 className="text-lg font-semibold">{t('resultsTitle')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
            <Kpi
              label={t('postsLive')}
              value={num(totals.postsLive)}
              sub={
                totals.postsPlanned > 0
                  ? t('ofPlanned', { planned: formatNumber(totals.postsPlanned) })
                  : null
              }
              percent={
                totals.postsPlanned > 0
                  ? Math.round((totals.postsLive / totals.postsPlanned) * 100)
                  : null
              }
              t={t}
            />
            <TargetKpi label={t('views')} target={totals.views} format={num} t={t} />
            <TargetKpi label={t('engagements')} target={totals.engagements} format={num} t={t} />
            <TargetKpi
              label={t('engagementRate')}
              target={totals.engagementRate}
              format={pct}
              t={t}
            />
            {report.includeCosts ? (
              <>
                <Kpi
                  label={t('spend')}
                  value={totals.spend != null ? formatCurrency(totals.spend, currency) : '—'}
                  sub={
                    totals.plannedBudget
                      ? t('ofBudget', { budget: formatCurrency(totals.plannedBudget, currency) })
                      : null
                  }
                  percent={
                    totals.spend != null && totals.plannedBudget
                      ? Math.round((totals.spend / totals.plannedBudget) * 100)
                      : null
                  }
                  t={t}
                />
                <CostKpi
                  label={t('costPerView')}
                  target={totals.costPerView}
                  currency={currency}
                  t={t}
                />
              </>
            ) : null}
          </div>
        </section>

        {/* Sales from promo codes and tracking links (P3.1) */}
        {report.sales ? (
          <section className="break-inside-avoid space-y-3">
            <h2 className="text-lg font-semibold">{t('salesTitle')}</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label={t('orders')} value={num(report.sales.orders)} sub={null} percent={null} t={t} />
              <Kpi
                label={t('revenue')}
                value={
                  report.sales.revenue.length
                    ? report.sales.revenue.map((r) => formatCurrency(r.amount, r.currency)).join(' · ')
                    : formatCurrency(0, currency)
                }
                sub={null}
                percent={null}
                t={t}
              />
              <Kpi label={t('linkClicks')} value={num(report.sales.clicks)} sub={null} percent={null} t={t} />
              {report.includeCosts ? (
                <Kpi
                  label={t('roas')}
                  value={report.sales.roas != null ? `${formatNumber(report.sales.roas)}×` : '—'}
                  sub={
                    report.sales.costPerOrder != null
                      ? t('costPerOrder', { amount: formatCurrency(report.sales.costPerOrder, currency) })
                      : null
                  }
                  percent={null}
                  t={t}
                />
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">{t('salesNote')}</p>
          </section>
        ) : null}

        {/* Creators */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('creatorsTitle')}</h2>
          {report.creators.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('noCreators')}</p>
          ) : (
            <div className="border-border overflow-x-auto rounded-xl border print:overflow-visible">
              <table className="w-full min-w-[640px] text-sm print:min-w-0">
                <thead className="bg-surface-muted/60 text-muted-foreground text-xs">
                  <tr>
                    <Th>{t('colCreator')}</Th>
                    <Th end>{t('colPosts')}</Th>
                    <Th end>{t('views')}</Th>
                    <Th end>{t('engagements')}</Th>
                    <Th end>{t('engagementRate')}</Th>
                    {report.includeCosts ? (
                      <>
                        <Th end>{t('spend')}</Th>
                        <Th end>{t('costPerView')}</Th>
                      </>
                    ) : null}
                    {report.sales ? (
                      <>
                        <Th end>{t('orders')}</Th>
                        <Th end>{t('revenue')}</Th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {report.creators.map((r) => (
                    <tr key={r.influencerId} className="border-border break-inside-avoid border-t">
                      <td className="px-3 py-2.5">
                        <p className="font-medium">
                          <BidiText>{r.name}</BidiText>
                        </p>
                        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                          {r.platforms.map((p) => (
                            <PlatformIcon key={p} platform={p} className="h-3.5 w-3.5" />
                          ))}
                          {r.handle ? <LtrText>@{r.handle}</LtrText> : null}
                        </p>
                      </td>
                      <Td end>
                        <LtrText>
                          {r.postsLive}/{r.postsPlanned}
                        </LtrText>
                      </Td>
                      <Td end>{num(r.views)}</Td>
                      <Td end>{num(r.engagements)}</Td>
                      <Td end>{pct(r.engagementRate)}</Td>
                      {report.includeCosts ? (
                        <>
                          <Td end>
                            {r.spend != null ? (
                              <LtrText>{formatCurrency(r.spend, currency)}</LtrText>
                            ) : (
                              '—'
                            )}
                          </Td>
                          <Td end>
                            <LtrText>{rate(r.costPerView, currency)}</LtrText>
                          </Td>
                        </>
                      ) : null}
                      {report.sales ? (
                        <>
                          <Td end>{num(r.sales?.orders ?? 0)}</Td>
                          <Td end>
                            <LtrText>
                              {r.sales?.revenue.length
                                ? r.sales.revenue.map((m) => formatCurrency(m.amount, m.currency)).join(' · ')
                                : '—'}
                            </LtrText>
                          </Td>
                        </>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Top posts */}
        {topPosts.length > 0 ? (
          <section className="break-inside-avoid space-y-3">
            <h2 className="text-lg font-semibold">{t('topPostsTitle')}</h2>
            <div className="grid gap-3 sm:grid-cols-3 print:grid-cols-3">
              {topPosts.map((p) => (
                <div key={p.id} className="border-border overflow-hidden rounded-xl border">
                  <div className="bg-surface-muted flex aspect-[4/5] items-center justify-center">
                    {p.thumbnailUrl ? (
                      <SafeImg
                        src={p.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        fallback={
                          <PlatformIcon
                            platform={p.platform}
                            className="text-muted-foreground h-8 w-8"
                          />
                        }
                      />
                    ) : (
                      <PlatformIcon
                        platform={p.platform}
                        className="text-muted-foreground h-8 w-8"
                      />
                    )}
                  </div>
                  <div className="space-y-1 p-3 text-sm">
                    <p className="truncate font-medium">
                      {p.creatorName ? <BidiText>{p.creatorName}</BidiText> : '—'}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t('viewsCount', { views: num(p.views) })} ·{' '}
                      {t('engagementsCount', { count: num(p.engagements) })}
                    </p>
                    {p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand inline-flex items-center gap-1 text-xs font-medium hover:underline"
                      >
                        {t('openPost')} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* All posts */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('allPostsTitle')}</h2>
          {report.posts.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('noPosts')}</p>
          ) : (
            <div className="border-border overflow-x-auto rounded-xl border print:overflow-visible">
              <table className="w-full min-w-[640px] text-sm print:min-w-0">
                <thead className="bg-surface-muted/60 text-muted-foreground text-xs">
                  <tr>
                    <Th>{t('colCreator')}</Th>
                    <Th>{t('colPublished')}</Th>
                    <Th end>{t('views')}</Th>
                    <Th end>{t('engagements')}</Th>
                    <Th end>{t('engagementRate')}</Th>
                    {report.includeCosts ? <Th end>{t('costPerView')}</Th> : null}
                    <Th>{t('colLink')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.posts.map((p) => (
                    <tr
                      key={p.id}
                      className={cn(
                        'border-border break-inside-avoid border-t',
                        p.removed && 'text-muted-foreground',
                      )}
                    >
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <PlatformIcon platform={p.platform} className="h-3.5 w-3.5 shrink-0" />
                          {p.creatorName ? <BidiText>{p.creatorName}</BidiText> : '—'}
                        </span>
                      </td>
                      <Td>{p.publishedAt ? shortDate(p.publishedAt, locale) : '—'}</Td>
                      <Td end>{num(p.views)}</Td>
                      <Td end>{num(p.engagements)}</Td>
                      <Td end>{pct(p.engagementRate)}</Td>
                      {report.includeCosts ? (
                        <Td end>
                          <LtrText>{rate(p.costPerView, currency)}</LtrText>
                        </Td>
                      ) : null}
                      <Td>
                        {p.removed ? (
                          t('removed')
                        ) : p.url ? (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand hover:underline"
                          >
                            {t('openPost')}
                          </a>
                        ) : (
                          t('story')
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="border-border text-muted-foreground border-t pt-4 text-xs">
          {report.metricsLastSyncedAt
            ? t('footnote', { date: shortDate(report.metricsLastSyncedAt, locale) })
            : t('footnoteNoDate')}
        </footer>
      </article>

      <p className="text-muted-foreground text-center text-xs print:hidden">
        <Link href={`/campaigns/${c.id}`} className="hover:underline">
          {t('back')}
        </Link>
      </p>
    </div>
  );
}

function Th({ children, end = false }: { children: React.ReactNode; end?: boolean }) {
  return (
    <th className={cn('px-3 py-2 font-semibold', end ? 'text-end' : 'text-start')}>{children}</th>
  );
}

function Td({ children, end = false }: { children: React.ReactNode; end?: boolean }) {
  return (
    <td className={cn('px-3 py-2 tabular-nums', end ? 'text-end' : 'text-start')}>{children}</td>
  );
}

function Bar({ percent }: { percent: number | null }) {
  if (percent == null) return null;
  return (
    <div className="bg-surface-muted mt-2 h-1.5 overflow-hidden rounded-full">
      <div
        className={cn('h-full rounded-full', percent >= 100 ? 'bg-success' : 'bg-brand')}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  percent,
  t,
}: {
  label: string;
  value: string;
  sub: string | null;
  percent: number | null;
  t: T;
}) {
  return (
    <div className="border-border break-inside-avoid rounded-xl border p-4">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      {/* Long money values shrink and may wrap after the currency code. */}
      <p
        className={
          value.length > 14
            ? 'mt-1 text-lg font-bold tabular-nums'
            : value.length > 11
              ? 'mt-1 text-xl font-bold tabular-nums'
              : 'mt-1 text-2xl font-bold tabular-nums'
        }
      >
        <LtrText>{value.replace(/\u00a0/g, ' ')}</LtrText>
      </p>
      {sub ? <p className="text-muted-foreground text-xs">{sub}</p> : null}
      {percent != null ? (
        <p className="mt-1 text-xs font-medium">{t('percentOfTarget', { percent })}</p>
      ) : null}
      <Bar percent={percent} />
    </div>
  );
}

function TargetKpi({
  label,
  target,
  format,
  t,
}: {
  label: string;
  target: ReportTargetDTO;
  format: (v: number | null) => string;
  t: T;
}) {
  return (
    <Kpi
      label={label}
      value={format(target.actual)}
      sub={target.target != null ? t('target', { value: format(target.target) }) : t('noTarget')}
      percent={target.percent}
      t={t}
    />
  );
}

/** Cost per view: lower is better, so it reads "within target" / "above target". */
function CostKpi({
  label,
  target,
  currency,
  t,
}: {
  label: string;
  target: ReportTargetDTO;
  currency: string;
  t: T;
}) {
  const within =
    target.actual != null && target.target != null ? target.actual <= target.target : null;
  return (
    <div className="border-border break-inside-avoid rounded-xl border p-4">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">
        <LtrText>{rate(target.actual, currency)}</LtrText>
      </p>
      <p className="text-muted-foreground text-xs">
        {target.target != null
          ? t('target', { value: rate(target.target, currency) })
          : t('noTarget')}
      </p>
      {within != null ? (
        <p className={cn('mt-1 text-xs font-medium', within ? 'text-success' : 'text-warning')}>
          {within ? t('withinTarget') : t('aboveTarget')}
        </p>
      ) : null}
    </div>
  );
}
