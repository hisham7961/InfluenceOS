'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, TableProperties } from 'lucide-react';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Skeleton } from '@/components/ui/skeleton';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { BidiText } from '@/components/common/bidi-text';
import { useLocalizedFormat } from '@/lib/format';
import { METRIC_FIELDS, invalidateMetricQueries, parseCount, type MetricField } from './enter-metrics-dialog';
import { errorMessage } from '@/lib/errors';

const MAX_POSTS = 300;

/** Every post of the campaign (the page's own list is capped). */
async function loadAllCampaignContent(campaignId: string): Promise<PublishedContentDTO[]> {
  const all: PublishedContentDTO[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.content.feed({ campaignId, limit: 60, cursor });
    all.push(...page.data);
    cursor = page.hasMore ? (page.nextCursor ?? undefined) : undefined;
  } while (cursor && all.length < MAX_POSTS);
  return all;
}

type Row = Record<MetricField, string>;

function rowFrom(c: PublishedContentDTO): Row {
  return Object.fromEntries(METRIC_FIELDS.map((k) => [k, c.metrics?.[k] != null ? String(c.metrics[k]) : ''])) as Row;
}

function todayInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * End-of-campaign entry: one grid with every post of the campaign, prefilled
 * with the numbers already on record. Only rows that were changed are sent,
 * so re-saving never adds duplicate history.
 */
export function BulkMetricsDialog({ campaignId }: { campaignId: string }) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const qc = useQueryClient();
  const router = useRouter();
  const { shortDate } = useLocalizedFormat();
  const [open, setOpen] = React.useState(false);
  const [edits, setEdits] = React.useState<Record<string, Row>>({});
  const [asOf, setAsOf] = React.useState(todayInput);

  const posts = useQuery({
    queryKey: ['campaign-content', campaignId, 'all-for-metrics'],
    queryFn: () => loadAllCampaignContent(campaignId),
    enabled: open,
  });

  React.useEffect(() => {
    if (open) {
      setEdits({});
      setAsOf(todayInput());
    }
  }, [open]);

  const rows = posts.data ?? [];
  const changed = rows.filter((c) => {
    const e = edits[c.id];
    if (!e) return false;
    const orig = rowFrom(c);
    return METRIC_FIELDS.some((k) => e[k].trim() !== orig[k]);
  });
  const invalid = changed.some((c) => METRIC_FIELDS.some((k) => parseCount(edits[c.id]![k]) === 'invalid'));

  const save = useMutation({
    mutationFn: () =>
      api.content.addMetricsBulk(campaignId, {
        capturedAt: asOf === todayInput() ? new Date() : new Date(`${asOf}T12:00:00`),
        entries: changed.map((c) => {
          const e = edits[c.id]!;
          const entry: Record<string, string | number | null> = { contentId: c.id };
          for (const k of METRIC_FIELDS) entry[k] = parseCount(e[k]) as number | null;
          return entry as { contentId: string };
        }),
      }),
    onSuccess: (res) => {
      toast.success(t('metricsEntry.bulkSaved', { count: res.recorded }));
      invalidateMetricQueries(qc);
      router.refresh();
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const setCell = (c: PublishedContentDTO, k: MetricField, value: string) =>
    setEdits((prev) => ({ ...prev, [c.id]: { ...(prev[c.id] ?? rowFrom(c)), [k]: value } }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <TableProperties className="h-3.5 w-3.5" /> {t('metricsEntry.bulkOpen')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('metricsEntry.bulkTitle')}</DialogTitle>
          <DialogDescription>{t('metricsEntry.bulkDescription')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('metricsEntry.asOf')} className="w-44">
            <Input type="date" dir="ltr" value={asOf} max={todayInput()} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
          <p className="pb-2 text-xs text-muted-foreground">{t('metricsEntry.hint')}</p>
        </div>

        <div className="max-h-[55vh] overflow-auto rounded-lg border border-border">
          {posts.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('metricsEntry.bulkEmpty')}</p>
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-start text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">{t('metricsEntry.post')}</th>
                  {METRIC_FIELDS.map((k) => (
                    <th key={k} className="px-2 py-2 text-start font-medium">
                      {t(`metricsEntry.fields.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((c) => {
                  const row = edits[c.id] ?? rowFrom(c);
                  return (
                    <tr key={c.id}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <PlatformBadge platform={c.platform} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              <BidiText>{c.influencer?.displayName ?? '—'}</BidiText>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {shortDate(c.publishedAt ?? c.detectedAt)}
                              {c.isStory ? ` · ${t('grid.storyBadge')}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      {METRIC_FIELDS.map((k) => (
                        <td key={k} className="px-2 py-2">
                          <Input
                            inputMode="numeric"
                            dir="ltr"
                            aria-label={t(`metricsEntry.fields.${k}`)}
                            className={parseCount(row[k]) === 'invalid' ? 'h-8 w-24 border-danger' : 'h-8 w-24'}
                            value={row[k]}
                            onChange={(e) => setCell(c, k, e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground">{t('metricsEntry.bulkChanged', { count: changed.length })}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
              {tCommon('cancel')}
            </Button>
            <Button type="button" disabled={save.isPending || invalid || changed.length === 0 || !asOf} onClick={() => save.mutate()}>
              {save.isPending ? <Spinner className="text-current" /> : <Check className="h-4 w-4" />}
              {save.isPending ? tCommon('saving') : tCommon('save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
