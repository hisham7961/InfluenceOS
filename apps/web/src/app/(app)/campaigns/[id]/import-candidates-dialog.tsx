'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Check, FileUp, Search, Upload } from 'lucide-react';
import type { BulkPreviewDTO, BulkResultDTO } from '@influenceos/contracts';
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
import { Field, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
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
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [csv, setCsv] = React.useState('');
  const [preview, setPreview] = React.useState<BulkPreviewDTO | null>(null);
  const [result, setResult] = React.useState<BulkResultDTO | null>(null);

  const previewCsv = useMutation({
    mutationFn: () => api.campaigns.previewImportCandidates(campaignId, { csv: csv.trim() }),
    onSuccess: (data) => setPreview(data),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const importCsv = useMutation({
    mutationFn: () => api.campaigns.importCandidates(campaignId, { csv: csv.trim() }),
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ['campaign-candidates', campaignId] });
      if (res.added > 0) toast.success(`Imported ${res.added} candidate${res.added === 1 ? '' : 's'}.`);
      else toast.message('No new candidates were added.');
    },
    onError: (e) => toast.error(errorMessage(e)),
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
          <FileUp className="h-4 w-4" aria-hidden /> Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import creators from CSV</DialogTitle>
          <DialogDescription>
            {result
              ? `Imported into this campaign's sourcing pipeline.`
              : preview
                ? 'Review what would happen, then confirm the import.'
                : (
                  <>
                    Paste a CSV with a header row. <code className="text-xs">displayName</code> (or{' '}
                    <code className="text-xs">name</code>) is required; optional columns:{' '}
                    <span className="text-xs">fullName, username/handle, platform, email, category, country, fitScore, notes</span>.
                  </>
                )}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">{result.added} added</Badge>
              <Badge tone="neutral">{result.skipped} skipped</Badge>
              <Badge tone="danger">{result.failed} failed</Badge>
            </div>
            {failedRows.length > 0 ? (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface-muted/50 p-3 text-xs">
                {failedRows.slice(0, 20).map((r, i) => (
                  <p key={i} className="text-muted-foreground">
                    <span className="font-medium text-foreground">{r.label ?? 'Row'}</span> — {r.message ?? 'could not import'}
                  </p>
                ))}
                {failedRows.length > 20 ? <p className="text-muted-foreground">…and {failedRows.length - 20} more</p> : null}
              </div>
            ) : null}
          </div>
        ) : preview ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">{preview.willUpdate} will import</Badge>
              <Badge tone="neutral">{preview.willSkip} will skip</Badge>
              {preview.willCreate != null && preview.willCreate > 0 ? (
                <Badge tone="info">{preview.willCreate} new creator{preview.willCreate === 1 ? '' : 's'}</Badge>
              ) : null}
            </div>

            {duplicateWarnings.length > 0 ? (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                <p>
                  {duplicateWarnings.length} row{duplicateWarnings.length === 1 ? '' : 's'} may duplicate an existing creator — review the
                  warnings below. Importing will still create a new influencer for each unless you fix the row and preview again.
                </p>
              </div>
            ) : null}

            <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2 text-sm">
              {preview.rows.map((row, i) => (
                <div key={i} className="flex items-start justify-between gap-3 px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.label ?? 'Row'}</p>
                    {row.message ? <p className="truncate text-xs text-muted-foreground">{row.message}</p> : null}
                  </div>
                  <Badge tone={row.status === 'added' ? (row.message ? 'warning' : 'success') : 'neutral'} className="shrink-0">
                    {row.status === 'added' ? (row.message ? 'Possible dup' : 'Will import') : 'Skip'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Field label="CSV" hint="One creator per row. The first row is the header.">
            <Textarea
              autoFocus
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={SAMPLE}
              rows={9}
              className="font-mono text-xs"
              aria-label="CSV of creators to import"
            />
          </Field>
        )}

        <DialogFooter>
          {result ? (
            <Button type="button" onClick={reset}>
              <Check className="h-4 w-4" aria-hidden /> Done
            </Button>
          ) : preview ? (
            <>
              <Button type="button" variant="outline" onClick={() => setPreview(null)}>
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back
              </Button>
              <Button disabled={preview.willUpdate === 0 || importCsv.isPending} onClick={() => importCsv.mutate()}>
                <Upload className="h-4 w-4" aria-hidden /> {importCsv.isPending ? 'Importing…' : `Import ${preview.willUpdate}`}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={reset}>
                Cancel
              </Button>
              <Button disabled={csv.trim().length === 0 || previewCsv.isPending} onClick={() => previewCsv.mutate()}>
                <Search className="h-4 w-4" aria-hidden /> {previewCsv.isPending ? 'Checking…' : 'Preview'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
