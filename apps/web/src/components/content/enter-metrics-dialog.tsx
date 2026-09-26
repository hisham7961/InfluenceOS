'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BarChart3, Check } from 'lucide-react';
import type { ContentMetricsDTO, PublishedContentDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { AttachmentsPanel } from '@/components/common/attachments-panel';
import { formatCompact, useLocalizedFormat } from '@/lib/format';

export const METRIC_FIELDS = ['views', 'likes', 'comments', 'shares', 'saves'] as const;
export type MetricField = (typeof METRIC_FIELDS)[number];

/** Everything that shows metrics, so one save updates every open view. */
export function invalidateMetricQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({
    predicate: (q) => {
      const root = q.queryKey[0];
      return (
        root === 'content-feed' ||
        root === 'content-summary' ||
        root === 'campaign-efficiency' ||
        root === 'campaign-content' ||
        root === 'content' ||
        root === 'dashboard-global'
      );
    },
  });
}

function todayInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "12,300", "12.3k" and "" all read sensibly; anything else is invalid. */
export function parseCount(raw: string): number | null | 'invalid' {
  const v = raw.trim().toLowerCase().replace(/[,\s]/g, '');
  if (v === '') return null;
  const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(v);
  if (!m) return 'invalid';
  const n = Number(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1);
  return Number.isFinite(n) ? Math.round(n) : 'invalid';
}

/**
 * Type in a post's numbers — the only way to get them for Snapchat, TikTok
 * and Stories, which have no metrics API. Prefilled with the latest numbers;
 * the as-of date lets an older insights screenshot join the history without
 * becoming "latest". The screenshot itself can be attached right here.
 */
export function EnterMetricsDialog({
  content,
  trigger,
  onSaved,
}: {
  content: PublishedContentDTO;
  trigger?: React.ReactNode;
  onSaved?: (updated: PublishedContentDTO) => void;
}) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<Record<MetricField, string>>(() => blankValues(content.metrics));
  const [asOf, setAsOf] = React.useState(todayInput);

  React.useEffect(() => {
    if (open) {
      setValues(blankValues(content.metrics));
      setAsOf(todayInput());
    }
  }, [open, content.metrics]);

  const parsed = Object.fromEntries(METRIC_FIELDS.map((k) => [k, parseCount(values[k])])) as Record<
    MetricField,
    number | null | 'invalid'
  >;
  const invalid = METRIC_FIELDS.some((k) => parsed[k] === 'invalid');
  const empty = METRIC_FIELDS.every((k) => parsed[k] === null);

  const save = useMutation({
    mutationFn: () => {
      const numbers = Object.fromEntries(METRIC_FIELDS.map((k) => [k, parsed[k] as number | null]));
      // Noon local time: a date typed in Kuwait stays that date in UTC.
      const capturedAt = asOf === todayInput() ? new Date() : new Date(`${asOf}T12:00:00`);
      return api.content.addMetrics(content.id, { ...numbers, capturedAt });
    },
    onSuccess: (updated) => {
      toast.success(t('metricsEntry.saved'));
      invalidateMetricQueries(qc);
      router.refresh();
      onSaved?.(updated);
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tCommon('somethingWentWrong')),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm">
            <BarChart3 className="h-3.5 w-3.5" /> {t('metricsEntry.open')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('metricsEntry.title')}</DialogTitle>
          <DialogDescription>{t('metricsEntry.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {METRIC_FIELDS.map((k) => (
            <Field key={k} label={t(`metricsEntry.fields.${k}`)} error={parsed[k] === 'invalid' ? t('metricsEntry.invalidNumber') : undefined}>
              <Input
                inputMode="numeric"
                dir="ltr"
                value={values[k]}
                placeholder="—"
                onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
              />
            </Field>
          ))}
          <Field label={t('metricsEntry.asOf')}>
            <Input type="date" dir="ltr" value={asOf} max={todayInput()} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">{t('metricsEntry.hint')}</p>

        <MetricsHistory contentId={content.id} enabled={open} />

        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t('metricsEntry.screenshot')}</p>
          <AttachmentsPanel target={{ publishedContentId: content.id }} inline />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={save.isPending || invalid || empty || !asOf} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner className="text-current" /> : <Check className="h-4 w-4" />}
            {save.isPending ? tCommon('saving') : tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function blankValues(m: ContentMetricsDTO | null): Record<MetricField, string> {
  return Object.fromEntries(METRIC_FIELDS.map((k) => [k, m?.[k] != null ? String(m[k]) : ''])) as Record<
    MetricField,
    string
  >;
}

/** Earlier entries, oldest → newest, with a views sparkline. */
function MetricsHistory({ contentId, enabled }: { contentId: string; enabled: boolean }) {
  const t = useTranslations('content');
  const { shortDate } = useLocalizedFormat();
  const history = useQuery({
    queryKey: ['content', contentId, 'metrics-history'],
    queryFn: () => api.content.metrics(contentId),
    enabled,
  });
  const rows = history.data ?? [];
  if (rows.length === 0) return null;
  const views = rows.map((r) => r.views).filter((v): v is number => v != null);
  return (
    <div className="rounded-lg bg-surface-muted p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-medium text-muted-foreground">{t('metricsEntry.history', { count: rows.length })}</p>
        {views.length > 1 ? <Sparkline points={views} /> : null}
      </div>
      <ul className="max-h-28 space-y-1 overflow-y-auto">
        {[...rows].reverse().slice(0, 8).map((r, i) => (
          <li key={`${r.capturedAt}-${i}`} className="flex justify-between gap-2 text-muted-foreground">
            <span>{r.capturedAt ? shortDate(r.capturedAt) : '—'}</span>
            <span dir="ltr">
              {formatCompact(r.views)} · {formatCompact(r.likes)} · {formatCompact(r.comments)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sparkline({ points, width = 96, height = 24 }: { points: number[]; width?: number; height?: number }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * (width - 2) + 1;
      const y = height - 1 - ((p - min) / span) * (height - 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="shrink-0 text-brand" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
