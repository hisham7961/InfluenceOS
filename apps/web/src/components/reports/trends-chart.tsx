'use client';

import { format, parseISO } from 'date-fns';
import { useLocale, useTranslations } from 'next-intl';
import { Area, Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrendsDTO } from '@influenceos/contracts';
import type { Locale } from '@/i18n/request';
import { dateFnsLocale, formatCompact, formatCurrency, formatNumber } from '@/lib/format';

export type TrendMetric = 'posts' | 'views' | 'paid';

const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: '1px solid hsl(var(--border))',
  background: 'hsl(var(--card))',
  fontSize: 12,
  boxShadow: '0 8px 24px -8px rgb(0 0 0 / 0.25)',
};
const TICK = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

/** The chart itself — split out so recharts loads only when it's shown. */
export function TrendsChart({ data, metric }: { data: TrendsDTO; metric: TrendMetric }) {
  const t = useTranslations('reports');
  const locale = useLocale() as Locale;
  const dfLocale = dateFnsLocale(locale);
  const currency = data.currencies[0] ?? 'KWD';
  const label = (start: string, long = false) =>
    data.bucket === 'month'
      ? format(parseISO(start), long ? 'MMMM yyyy' : 'MMM yy', { locale: dfLocale })
      : long
        ? t('exec.trends.weekOf', { date: format(parseISO(start), 'd MMM yyyy', { locale: dfLocale }) })
        : format(parseISO(start), 'd MMM', { locale: dfLocale });

  const rows = data.points.map((p) => ({
    start: p.start,
    posts: p.postsPublished,
    delivered: p.deliverablesDelivered,
    views: p.views ?? 0,
    paid: p.paid?.find((c) => c.currency === currency)?.amount ?? 0,
  }));

  const names: Record<string, string> = {
    posts: t('exec.trends.series.posts'),
    delivered: t('exec.trends.series.delivered'),
    views: t('exec.trends.series.views'),
    paid: t('exec.trends.series.paid', { currency }),
  };
  const valueText = (key: string, v: number) =>
    key === 'paid' ? formatCurrency(v, currency) : key === 'views' ? formatCompact(v) : formatNumber(v);

  return (
    // Time runs left to right in both languages, like the other charts.
    <div className="h-72 w-full" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="execViewsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--brand))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--brand))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="start" tickFormatter={(d: string) => label(d)} tick={TICK} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis
            tickFormatter={(v: number) => formatCompact(v)}
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={48}
            allowDecimals={metric === 'paid'}
          />
          <Tooltip
            formatter={(value: number, key: string) => [valueText(key, value), names[key] ?? key]}
            labelFormatter={(d: string) => label(d, true)}
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: 'hsl(var(--surface-muted))' }}
          />
          <Legend formatter={(key: string) => <span className="text-xs text-muted-foreground">{names[key] ?? key}</span>} />
          {/* Recharts only sees direct children — no fragments here. */}
          {metric === 'posts' ? <Bar dataKey="posts" fill="hsl(var(--brand))" radius={[4, 4, 0, 0]} maxBarSize={28} /> : null}
          {metric === 'posts' ? <Bar dataKey="delivered" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} maxBarSize={28} /> : null}
          {metric === 'views' ? (
            <Area type="monotone" dataKey="views" stroke="hsl(var(--brand))" strokeWidth={2} fill="url(#execViewsFill)" />
          ) : null}
          {metric === 'paid' ? <Bar dataKey="paid" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} maxBarSize={28} /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
