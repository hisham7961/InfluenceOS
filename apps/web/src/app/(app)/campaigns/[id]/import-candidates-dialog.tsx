'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Check, FileUp, Search, Upload } from 'lucide-react';
import type { BulkPreviewDTO, BulkResultDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { BidiText } from '@/components/common/bidi-text';
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
import { Field, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

const SAMPLE = `displayName,username,platform,category,fitScore,notes
Layla Q,@laylaq,INSTAGRAM,Beauty,88,Strong KW audience
Omar K,@omark,TIKTOK,Lifestyle,72,Follow up next week`;

/**
 * Bulk creator intake (W3-4 web surface, gap #7): paste a CSV of creators,
 * Preview the exact per-row outcome the server computed — including an
 * advisory duplicate-detection warning on any row that would create a brand
 * new influencer (gap #4) — then Import to actually land them as sourcing
 * candidates. Never executes straight from the paste anymore: preview always
 * comes first, the same two-step pattern as the influencer directory's bulk
 * action bar. Unknown creators are created; existing ones are matched by
 * (platform, username) then display name. Each row is independent: a
 * duplicate is skipped, a bad row fails, the rest import.
 */
export function ImportCandidatesDialog({ campaignId }: { campaignId: string }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [csv, setCsv] = React.useState('');
  const [preview, setPreview] = React.useState<BulkPreviewDTO | null>(null);
  const [result, setResult] = React.useState<BulkResultDTO | null>(null);

  const previewCsv = useMutation({
    mutationFn: () => api.campaigns.previewImportCandidates(campaignId, { csv: csv.trim() }),
    onSuccess: (data) => setPreview(data),
    onError: (e) => toast.error(errorMessage(e, t('errors.generic'))),
  });

  const importCsv = useMutation({
    mutationFn: () => api.campaigns.importCandidates(campaignId, { csv: csv.trim() }),
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ['campaign-candidates', campaignId] });
      if (res.added > 0) toast.success(t('importCandidatesDialog.importedToast', { count: res.added }));
      else toast.message(t('importCandidatesDialog.noNewCandidates'));
    },
    onError: (e) => toast.error(errorMessage(e, t('errors.generic'))),
  });

  function reset() {
    setOpen(false);
    setCsv('');
    setPreview(null);
    setResult(null);
    previewCsv.reset();
    importCsv.reset();
  }

  const failedRows = result?.results.filter((r) => r.status === 'failed') ?? [];
  const duplicateWarnings = preview?.rows.filter((r) => r.status === 'added' && r.message) ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : reset())}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <FileUp className="h-4 w-4" aria-hidden /> {t('importCandidatesDialog.trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('importCandidatesDialog.title')}</DialogTitle>
          <DialogDescription>
            {result
              ? t('importCandidatesDialog.resultDescription')
              : preview
                ? t('importCandidatesDialog.previewDescription')
                : t.rich('importCandidatesDialog.csvInstructions', {
                    code: (chunks) => <code className="text-xs">{chunks}</code>,
                    cols: (chunks) => <span className="text-xs">{chunks}</span>,
                  })}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">{t('importCandidatesDialog.addedBadge', { count: result.added })}</Badge>
              <Badge tone="neutral">{t('importCandidatesDialog.skippedBadge', { count: result.skipped })}</Badge>
              <Badge tone="danger">{t('importCandidatesDialog.failedBadge', { count: result.failed })}</Badge>
            </div>
            {failedRows.length > 0 ? (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface-muted/50 p-3 text-xs">
                {failedRows.slice(0, 20).map((r, i) => (
                  <p key={i} className="text-muted-foreground">
                    <span className="font-medium text-foreground">
                      <BidiText>{r.label ?? t('importCandidatesDialog.rowFallback')}</BidiText>
                    </span>{' '}
                    — {r.message ?? t('importCandidatesDialog.couldNotImport')}
                  </p>
                ))}
                {failedRows.length > 20 ? (
                  <p className="text-muted-foreground">
                    {t('importCandidatesDialog.andMore', { count: failedRows.length - 20 })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : preview ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">{t('importCandidatesDialog.willImportBadge', { count: preview.willUpdate })}</Badge>
              <Badge tone="neutral">{t('importCandidatesDialog.willSkipBadge', { count: preview.willSkip })}</Badge>
              {preview.willCreate != null && preview.willCreate > 0 ? (
                <Badge tone="info">
                  {t('importCandidatesDialog.newCreatorsBadge', { count: preview.willCreate })}
                </Badge>
              ) : null}
            </div>

            {duplicateWarnings.length > 0 ? (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                {/* min-w-0 lets this text wrap onto multiple lines instead of
                    being clipped at the dialog's edge — a flex child's
                    default min-width:auto otherwise refuses to shrink below
                    its unwrapped content width. */}
                <p className="min-w-0 flex-1">
                  {t('importCandidatesDialog.duplicateWarning', { count: duplicateWarnings.length })}
                </p>
              </div>
            ) : null}

            <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2 text-sm">
              {preview.rows.map((row, i) => (
                <div key={i} className="flex items-start justify-between gap-3 px-2 py-1.5">
                  {/* flex-1 alongside min-w-0 so this block is actually
                      constrained to the row's available width — without it,
                      the row (and the whole dialog) could overflow instead of
                      the text cleanly truncating with an ellipsis. */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      <BidiText>{row.label ?? t('importCandidatesDialog.rowFallback')}</BidiText>
                    </p>
                    {row.message ? <p className="truncate text-xs text-muted-foreground">{row.message}</p> : null}
                  </div>
                  <Badge tone={row.status === 'added' ? (row.message ? 'warning' : 'success') : 'neutral'} className="shrink-0">
                    {row.status === 'added'
                      ? row.message
                        ? t('importCandidatesDialog.possibleDup')
                        : t('importCandidatesDialog.willImportLabel')
                      : t('bulkAddInfluencersDialog.skipLabel')}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Field label={t('importCandidatesDialog.csvFieldLabel')} hint={t('importCandidatesDialog.csvFieldHint')}>
            <Textarea
              autoFocus
              dir="ltr"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={SAMPLE}
              rows={9}
              className="font-mono text-xs"
              aria-label={t('importCandidatesDialog.csvAriaLabel')}
            />
          </Field>
        )}

        <DialogFooter>
          {result ? (
            <Button type="button" onClick={reset}>
              <Check className="h-4 w-4" aria-hidden /> {t('importCandidatesDialog.doneButton')}
            </Button>
          ) : preview ? (
            <>
              <Button type="button" variant="outline" onClick={() => setPreview(null)}>
                <ArrowLeft className="rtl:-scale-x-100 h-4 w-4" aria-hidden /> {tCommon('back')}
              </Button>
              <Button disabled={preview.willUpdate === 0 || importCsv.isPending} onClick={() => importCsv.mutate()}>
                <Upload className="h-4 w-4" aria-hidden />{' '}
                {importCsv.isPending
                  ? t('importCandidatesDialog.importingLabel')
                  : t('importCandidatesDialog.importButtonWithCount', { count: preview.willUpdate })}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={reset}>
                {tCommon('cancel')}
              </Button>
              <Button disabled={csv.trim().length === 0 || previewCsv.isPending} onClick={() => previewCsv.mutate()}>
                <Search className="h-4 w-4" aria-hidden />{' '}
                {previewCsv.isPending ? t('importCandidatesDialog.checkingLabel') : t('bulkAddInfluencersDialog.previewButton')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
