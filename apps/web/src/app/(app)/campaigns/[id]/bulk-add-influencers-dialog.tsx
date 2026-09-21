'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Check, Loader2, Search, Users, X } from 'lucide-react';
import type { BulkPreviewDTO, DealType, InfluencerSummaryDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { DEAL_TYPES } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { formatCompact } from '@/lib/format';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText, LtrText } from '@/components/common/bidi-text';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar } from '@/components/ui/avatar';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/**
 * Bulk-add a selection of creators to a campaign roster at once (W3-4 gap
 * #6 — the roster bulk-add service had no UI at all before this). Reuses the
 * same search-your-network picker as the single-creator "Add influencer"
 * dialog, but lets a manager check off several at once, then always shows a
 * real Preview (the exact per-row outcome the server computed) before the
 * write — the same two-step Preview → Execute pattern as the influencer
 * directory's BulkActionBar, so what gets confirmed is exactly what happens.
 */
export function BulkAddInfluencersDialog({
  campaignId,
  existingInfluencerIds = [],
}: {
  campaignId: string;
  existingInfluencerIds?: string[];
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const router = useRouter();
  const queryClient = useQueryClient();

  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<'select' | 'preview'>('select');
  const [query, setQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const [selected, setSelected] = React.useState<Map<string, InfluencerSummaryDTO>>(new Map());
  const [dealType, setDealType] = React.useState<DealType>('PAID');
  const [agreedCost, setAgreedCost] = React.useState('');
  const [preview, setPreview] = React.useState<BulkPreviewDTO | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const search = useQuery({
    queryKey: ['campaign-bulk-influencer-search', debouncedQuery],
    queryFn: () => api.influencers.list({ q: debouncedQuery, pageSize: 12 }),
    enabled: open && debouncedQuery.length > 0,
  });

  const excluded = React.useMemo(() => new Set(existingInfluencerIds), [existingInfluencerIds]);
  const results = (search.data?.data ?? []).filter((i) => !excluded.has(i.id));

  function toggle(inf: InfluencerSummaryDTO) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(inf.id)) next.delete(inf.id);
      else next.set(inf.id, inf);
      return next;
    });
  }

  function buildRows() {
    const cost = agreedCost.trim();
    return Array.from(selected.keys()).map((influencerId) => ({
      influencerId,
      dealType,
      agreedCost: cost ? Number(cost) : undefined,
    }));
  }

  const previewMutation = useMutation({
    mutationFn: () => api.campaigns.previewRosterAdd(campaignId, { rows: buildRows() }),
    onSuccess: (data) => {
      setPreview(data);
      setStep('preview');
    },
    onError: (e) => toast.error(errorMessage(e, t('errors.generic'))),
  });

  const executeMutation = useMutation({
    mutationFn: () => api.campaigns.addRosterInfluencers(campaignId, { rows: buildRows() }),
    onSuccess: (res) => {
      const failedSuffix = res.failed > 0 ? t('bulkAddInfluencersDialog.failedSuffix', { count: res.failed }) : '';
      toast.success(t('bulkAddInfluencersDialog.addedToast', { count: res.added, failedSuffix }));
      queryClient.invalidateQueries();
      router.refresh();
      resetAndClose();
    },
    onError: (e) => toast.error(errorMessage(e, t('errors.generic'))),
  });

  function resetAndClose() {
    setOpen(false);
    setStep('select');
    setQuery('');
    setDebouncedQuery('');
    setSelected(new Map());
    setDealType('PAID');
    setAgreedCost('');
    setPreview(null);
  }

  const selectedList = Array.from(selected.values());

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : resetAndClose())}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Users className="h-4 w-4" /> {t('bulkAddInfluencersDialog.trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('bulkAddInfluencersDialog.title')}</DialogTitle>
          <DialogDescription>
            {step === 'select'
              ? t('bulkAddInfluencersDialog.selectDescription')
              : preview
                ? t('bulkAddInfluencersDialog.previewDescription', {
                    willUpdate: preview.willUpdate,
                    selected: preview.selected,
                    willSkip: preview.willSkip,
                  })
                : ''}
          </DialogDescription>
        </DialogHeader>

        {step === 'select' ? (
          <div className="space-y-4">
            {selectedList.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {selectedList.map((inf) => (
                  <Badge key={inf.id} tone="accent" className="gap-1 pe-1">
                    <BidiText>{inf.displayName}</BidiText>
                    <button
                      type="button"
                      onClick={() => toggle(inf)}
                      aria-label={t('bulkAddInfluencersDialog.removeAriaLabel', { name: inf.displayName })}
                      className="ms-0.5 rounded-full hover:bg-accent/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : null}

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('addInfluencerDialog.searchPlaceholder')}
                className="pl-9"
              />
            </div>

            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {debouncedQuery.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                  {t('addInfluencerDialog.startTyping')}
                </p>
              ) : search.isLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              ) : results.length === 0 ? (
                <EmptyState
                  title={t('addInfluencerDialog.noMatches')}
                  description={t('addInfluencerDialog.noMatchesDescription')}
                  className="border-0 bg-transparent py-6"
                />
              ) : (
                results.map((inf) => {
                  const isSelected = selected.has(inf.id);
                  return (
                    <button
                      key={inf.id}
                      type="button"
                      onClick={() => toggle(inf)}
                      aria-pressed={isSelected}
                      className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors ${
                        isSelected ? 'border-brand/40 bg-brand-soft/40' : 'border-transparent hover:border-border hover:bg-surface-muted'
                      }`}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={isSelected}
                        className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-brand"
                        aria-hidden
                        tabIndex={-1}
                      />
                      <Avatar name={inf.displayName} src={inf.avatarUrl} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          <BidiText>{inf.displayName}</BidiText>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {inf.primaryUsername ? <LtrText>@{inf.primaryUsername}</LtrText> : (inf.category ?? '—')}
                        </p>
                      </div>
                      {inf.totalFollowers != null ? (
                        <span className="shrink-0 text-xs text-muted-foreground">{formatCompact(inf.totalFollowers)}</span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label={t('fields.dealType')} hint={t('bulkAddInfluencersDialog.dealTypeHint')}>
                <Select value={dealType} onValueChange={(v) => setDealType(v as DealType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEAL_TYPES.map((d) => (
                      <SelectItem key={d} value={d}>
                        {enumLabel(tEnums, 'dealType', d)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('workspace.influencers.agreedCostLabel')} hint={t('bulkAddInfluencersDialog.agreedCostHint')}>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={agreedCost}
                  onChange={(e) => setAgreedCost(e.target.value)}
                  placeholder="0.00"
                />
              </Field>
            </div>
          </div>
        ) : preview ? (
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border p-2 text-sm">
            {preview.rows.map((row, i) => (
              <div key={row.influencerId ?? i} className="flex items-center justify-between gap-2 px-2 py-1">
                <span className="truncate">
                  <BidiText>{row.label ?? tCommon('unknown')}</BidiText>
                </span>
                <Badge tone={row.status === 'added' ? 'success' : 'neutral'}>
                  {row.status === 'added' ? t('bulkAddInfluencersDialog.willAddLabel') : (row.message ?? t('bulkAddInfluencersDialog.skipLabel'))}
                </Badge>
              </div>
            ))}
          </div>
        ) : null}

        <DialogFooter>
          {step === 'select' ? (
            <>
              <Button type="button" variant="outline" onClick={resetAndClose}>
                {tCommon('cancel')}
              </Button>
              <Button disabled={selectedList.length === 0 || previewMutation.isPending} onClick={() => previewMutation.mutate()}>
                {previewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {selectedList.length > 0
                  ? t('bulkAddInfluencersDialog.previewButtonWithCount', { count: selectedList.length })
                  : t('bulkAddInfluencersDialog.previewButton')}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setStep('select')}>
                <ArrowLeft className="h-4 w-4" /> {tCommon('back')}
              </Button>
              <Button
                disabled={!preview || preview.willUpdate === 0 || executeMutation.isPending}
                onClick={() => executeMutation.mutate()}
              >
                {executeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t('bulkAddInfluencersDialog.addButton', { count: preview?.willUpdate ?? 0 })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
