'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, FileUp, Upload } from 'lucide-react';
import type { BulkResultDTO } from '@influenceos/contracts';
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
 * Bulk creator intake (W3-4 web surface): paste a CSV of creators and they land
 * as sourcing candidates on this campaign in one request — build a 100-creator
 * shortlist in minutes, not hundreds of clicks. Unknown creators are created;
 * existing ones are matched by (platform, username) then display name. Each row
 * is independent: a duplicate is skipped, a bad row fails, the rest import.
 */
export function ImportCandidatesDialog({ campaignId }: { campaignId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [csv, setCsv] = React.useState('');
  const [result, setResult] = React.useState<BulkResultDTO | null>(null);

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
    setResult(null);
    importCsv.reset();
  }

  const failedRows = result?.results.filter((r) => r.status === 'failed') ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : reset())}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <FileUp className="h-4 w-4" aria-hidden /> Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import creators from CSV</DialogTitle>
          <DialogDescription>
            Paste a CSV with a header row. <code className="text-xs">displayName</code> (or{' '}
            <code className="text-xs">name</code>) is required; optional columns:{' '}
            <span className="text-xs">fullName, username/handle, platform, email, category, country, fitScore, notes</span>.
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
          ) : (
            <>
              <Button type="button" variant="outline" onClick={reset}>
                Cancel
              </Button>
              <Button disabled={csv.trim().length === 0 || importCsv.isPending} onClick={() => importCsv.mutate()}>
                <Upload className="h-4 w-4" aria-hidden /> {importCsv.isPending ? 'Importing…' : 'Import'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
