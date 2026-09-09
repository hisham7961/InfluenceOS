'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Search, UserPlus } from 'lucide-react';
import type { DealType, InfluencerSummaryDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { DEAL_TYPES, DEAL_TYPE_LABELS } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { formatCompact } from '@/lib/format';
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
import { EmptyState } from '@/components/ui/empty-state';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
}

/**
 * Self-contained "Add influencer" trigger + dialog for a campaign's Influencers tab.
 * Search the network, pick a creator, set deal terms, and post it to the campaign roster.
 */
export function AddInfluencerDialog({
  campaignId,
  existingInfluencerIds = [],
}: {
  campaignId: string;
  existingInfluencerIds?: string[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const [selected, setSelected] = React.useState<InfluencerSummaryDTO | null>(null);
  const [dealType, setDealType] = React.useState<DealType>('PAID');
  const [agreedCost, setAgreedCost] = React.useState('');

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const search = useQuery({
    queryKey: ['campaign-influencer-search', debouncedQuery],
    queryFn: () => api.influencers.list({ q: debouncedQuery, pageSize: 8 }),
    enabled: open && debouncedQuery.length > 0,
  });

  const excluded = React.useMemo(() => new Set(existingInfluencerIds), [existingInfluencerIds]);
  const results = (search.data?.data ?? []).filter((i) => !excluded.has(i.id));

  const addInfluencer = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('Pick an influencer first.');
      const cost = agreedCost.trim();
      return api.campaigns.addInfluencer(campaignId, {
        influencerId: selected.id,
        dealType,
        agreedCost: cost ? Number(cost) : undefined,
      });
    },
    onSuccess: (ci) => {
      toast.success(`${ci.influencer.displayName} added to the campaign.`);
      queryClient.invalidateQueries();
      router.refresh();
      resetAndClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function resetAndClose() {
    setOpen(false);
    setQuery('');
    setDebouncedQuery('');
    setSelected(null);
    setDealType('PAID');
    setAgreedCost('');
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : resetAndClose())}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="h-4 w-4" /> Add influencer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add influencer to campaign</DialogTitle>
          <DialogDescription>Search your network, pick a creator, and set the deal terms.</DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or @username…"
                className="pl-9"
              />
            </div>

            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {debouncedQuery.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                  Start typing to search your influencer network.
                </p>
              ) : search.isLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              ) : results.length === 0 ? (
                <EmptyState
                  title="No matches"
                  description="Try a different name or username."
                  className="border-0 bg-transparent py-6"
                />
              ) : (
                results.map((inf) => (
                  <button
                    key={inf.id}
                    type="button"
                    onClick={() => setSelected(inf)}
                    className="flex w-full items-center gap-3 rounded-xl border border-transparent p-2.5 text-left transition-colors hover:border-border hover:bg-surface-muted"
                  >
                    <Avatar name={inf.displayName} src={inf.avatarUrl} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{inf.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {inf.primaryUsername ? `@${inf.primaryUsername}` : (inf.category ?? '—')}
                      </p>
                    </div>
                    {inf.totalFollowers != null ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{formatCompact(inf.totalFollowers)}</span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft/40 p-3">
              <Avatar name={selected.displayName} src={selected.avatarUrl} size="md" rounded="lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{selected.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {selected.primaryUsername ? `@${selected.primaryUsername}` : '—'}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Change
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Deal type">
                <Select value={dealType} onValueChange={(v) => setDealType(v as DealType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEAL_TYPES.map((d) => (
                      <SelectItem key={d} value={d}>
                        {DEAL_TYPE_LABELS[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Agreed cost" hint="Optional">
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
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button disabled={!selected || addInfluencer.isPending} onClick={() => addInfluencer.mutate()}>
            {addInfluencer.isPending ? <Spinner className="text-current" /> : <Check className="h-4 w-4" />}
            {addInfluencer.isPending ? 'Adding…' : 'Add to campaign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
