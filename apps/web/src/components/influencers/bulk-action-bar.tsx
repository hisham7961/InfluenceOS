'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Tag, UserCog, X } from 'lucide-react';
import { RELATIONSHIP_STATUSES, RELATIONSHIP_STATUS_LABELS } from '@influenceos/shared';
import type { BulkPreviewDTO, requests } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type BulkInfluencerRequest = requests.BulkInfluencerRequest;
type Action = BulkInfluencerRequest['action'];

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong.';
}

/**
 * The bulk action toolbar for the influencer directory (Operations
 * Intelligence pass, PART 52-54) — appears once 1+ rows are selected.
 * Always shows a real preview (the exact per-row outcome the server
 * computed, never a guess) before the admin-only execute step.
 */
export function BulkActionBar({ selected, onClear }: { selected: string[]; onClear: () => void }) {
  const [action, setAction] = React.useState<Action>('ASSIGN_OWNER');
  const [ownerId, setOwnerId] = React.useState('');
  const [tagName, setTagName] = React.useState('');
  const [status, setStatus] = React.useState<(typeof RELATIONSHIP_STATUSES)[number]>('ACTIVE');
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<BulkPreviewDTO | null>(null);
  const queryClient = useQueryClient();

  const directory = useQuery({ queryKey: ['team-directory'], queryFn: () => api.users.directory() });

  function buildInput(): BulkInfluencerRequest | null {
    if (action === 'ASSIGN_OWNER') {
      if (!ownerId) return null;
      return { action, influencerIds: selected, ownerId };
    }
    if (action === 'ADD_TAG') {
      if (!tagName.trim()) return null;
      return { action, influencerIds: selected, tagName: tagName.trim() };
    }
    return { action, influencerIds: selected, status };
  }

  const previewMutation = useMutation({
    mutationFn: (input: BulkInfluencerRequest) => api.influencers.bulkPreview(input),
    onSuccess: (data) => {
      setPreview(data);
      setPreviewOpen(true);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const executeMutation = useMutation({
    mutationFn: (input: BulkInfluencerRequest) => api.influencers.bulkExecute(input),
    onSuccess: (result) => {
      toast.success(`Updated ${result.added} creator${result.added === 1 ? '' : 's'}.${result.failed > 0 ? ` ${result.failed} failed.` : ''}`);
      setPreviewOpen(false);
      setPreview(null);
      onClear();
      queryClient.invalidateQueries({ queryKey: ['influencers'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const input = buildInput();

  if (selected.length === 0) return null;

  return (
    <>
      <div className="sticky bottom-4 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-card">
        <Badge tone="accent">{selected.length} selected</Badge>

        <Select value={action} onValueChange={(v) => setAction(v as Action)}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ASSIGN_OWNER">Assign owner</SelectItem>
            <SelectItem value="ADD_TAG">Add tag</SelectItem>
            <SelectItem value="SET_RELATIONSHIP_STATUS">Set relationship status</SelectItem>
          </SelectContent>
        </Select>

        {action === 'ASSIGN_OWNER' ? (
          <Select value={ownerId || undefined} onValueChange={setOwnerId}>
            <SelectTrigger className="h-9 w-48">
              <UserCog className="h-3.5 w-3.5" />
              <SelectValue placeholder="Choose owner…" />
            </SelectTrigger>
            <SelectContent>
              {(directory.data ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : action === 'ADD_TAG' ? (
          <Input
            className="h-9 w-44"
            placeholder="Tag name…"
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
            aria-label="Tag name"
          />
        ) : (
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RELATIONSHIP_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {RELATIONSHIP_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          type="button"
          size="sm"
          disabled={!input || previewMutation.isPending}
          onClick={() => input && previewMutation.mutate(input)}
        >
          {previewMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />}
          Preview
        </Button>

        <Button type="button" size="sm" variant="ghost" onClick={onClear} aria-label="Clear selection">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm bulk action</DialogTitle>
            <DialogDescription>
              {preview ? `${preview.willUpdate} of ${preview.selected} will be updated. ${preview.willSkip} will be skipped.` : ''}
            </DialogDescription>
          </DialogHeader>

          {preview ? (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2 text-sm">
              {preview.rows.map((row, i) => (
                <div key={row.influencerId ?? i} className="flex items-center justify-between gap-2 px-2 py-1">
                  <span className="truncate">{row.label ?? 'Unknown'}</span>
                  <Badge tone={row.status === 'added' ? 'success' : 'neutral'}>{row.status === 'added' ? 'Will update' : row.message ?? 'Skip'}</Badge>
                </div>
              ))}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPreviewOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!input || !preview || preview.willUpdate === 0 || executeMutation.isPending}
              onClick={() => input && executeMutation.mutate(input)}
            >
              {executeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Apply to {preview?.willUpdate ?? 0}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
