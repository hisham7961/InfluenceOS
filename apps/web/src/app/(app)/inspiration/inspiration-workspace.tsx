'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, Lightbulb, Pin, Plus, Trash2 } from 'lucide-react';
import type { BrandSummaryDTO, InspirationItemDTO } from '@influenceos/contracts';
import { INSPIRATION_CATEGORIES, INSPIRATION_CATEGORY_LABELS, type InspirationCategory } from '@influenceos/shared';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { EmptyState } from '@/components/ui/empty-state';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useApp } from '@/components/shell/app-context';
import { CommentThread } from '@/components/collaboration/comment-thread';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong.';
}

const CATEGORY_ALL = 'ALL';

function AddInspirationDialog({ brands, open, onOpenChange }: { brands: BrandSummaryDTO[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [note, setNote] = React.useState('');
  const [category, setCategory] = React.useState<InspirationCategory>('TREND');
  const [brandId, setBrandId] = React.useState<string>('');
  const [tags, setTags] = React.useState('');

  function reset() {
    setUrl('');
    setTitle('');
    setNote('');
    setCategory('TREND');
    setBrandId('');
    setTags('');
  }

  const create = useMutation({
    mutationFn: () =>
      api.inspiration.create({
        url: url.trim(),
        title: title.trim() || undefined,
        note: note.trim() || undefined,
        category,
        brandId: brandId || undefined,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toast.success('Saved to Inspiration');
      reset();
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ['inspiration'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save a trend or reference</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Link">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" autoFocus />
          </Field>
          <Field label="Title (optional)">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is it?" />
          </Field>
          <Field label="Why it's interesting (optional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Select value={category} onValueChange={(v) => setCategory(v as InspirationCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INSPIRATION_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {INSPIRATION_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Relevant brand (optional)">
              <Select value={brandId || CATEGORY_ALL} onValueChange={(v) => setBrandId(v === CATEGORY_ALL ? '' : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CATEGORY_ALL}>None</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Tags (comma-separated, optional)">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="hook, skincare, before-after" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!url.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InspirationCard({ item, onOpen }: { item: InspirationItemDTO; onOpen: () => void }) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="flex cursor-pointer flex-col gap-2 p-4 transition-shadow hover:shadow-pop"
    >
      <div className="flex items-start justify-between gap-2">
        <Badge tone="accent">{INSPIRATION_CATEGORY_LABELS[item.category]}</Badge>
        {item.pinned && <Pin className="h-4 w-4 shrink-0 text-brand" />}
      </div>
      <p className="line-clamp-2 font-medium">{item.title ?? item.url}</p>
      {item.note ? <p className="line-clamp-3 text-sm text-muted-foreground">{item.note}</p> : null}
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.slice(0, 4).map((t) => (
            <Badge key={t} tone="neutral" className="text-[10px]">
              #{t}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between pt-1 text-xs text-muted-foreground">
        <span>{item.brandName ?? 'All brands'}</span>
        <span>{relativeTime(item.createdAt)}</span>
      </div>
    </Card>
  );
}

function InspirationDetail({ item, onClose }: { item: InspirationItemDTO; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user } = useApp();
  const canModify = user.role === 'ADMIN' || item.submittedById === user.id;

  const togglePin = useMutation({
    mutationFn: () => api.inspiration.update(item.id, { pinned: !item.pinned }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inspiration'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.inspiration.remove(item.id),
    onSuccess: () => {
      toast.success('Removed');
      queryClient.invalidateQueries({ queryKey: ['inspiration'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Badge tone="accent">{INSPIRATION_CATEGORY_LABELS[item.category]}</Badge>
          <h2 className="mt-2 text-lg font-semibold">{item.title ?? 'Untitled'}</h2>
          <p className="text-xs text-muted-foreground">
            Saved by {item.submittedByName ?? 'Unknown'} · {relativeTime(item.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" title={item.pinned ? 'Unpin' : 'Pin'} disabled={togglePin.isPending} onClick={() => togglePin.mutate()}>
            <Pin className={cn('h-4 w-4', item.pinned && 'text-brand')} />
          </Button>
          {canModify && (
            <Button variant="ghost" size="icon-sm" title="Remove" disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 className="h-4 w-4 text-danger" />
            </Button>
          )}
        </div>
      </div>

      <Button asChild variant="secondary" size="sm">
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          Open link <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Button>

      {item.note ? <p className="whitespace-pre-wrap text-sm text-foreground/90">{item.note}</p> : null}

      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.map((t) => (
            <Badge key={t} tone="neutral">
              #{t}
            </Badge>
          ))}
        </div>
      )}

      <div className="border-t border-border pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Discussion</p>
        <CommentThread
          context={{ inspirationItemId: item.id }}
          cacheKey={`inspiration:${item.id}`}
          emptyTitle="No comments yet"
          emptyDescription="What could we borrow from this?"
          composerPlaceholder="Add a thought… use @ to mention someone"
        />
      </div>
    </div>
  );
}

export function InspirationWorkspace({ brands }: { brands: BrandSummaryDTO[] }) {
  const [addOpen, setAddOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [category, setCategory] = React.useState<InspirationCategory | typeof CATEGORY_ALL>(CATEGORY_ALL);
  const [pinnedOnly, setPinnedOnly] = React.useState(false);

  const query = useQuery({
    queryKey: ['inspiration', { category, pinnedOnly }],
    queryFn: () =>
      api.inspiration.list({
        limit: 30,
        category: category === CATEGORY_ALL ? undefined : category,
        pinned: pinnedOnly || undefined,
      }),
  });

  const items = query.data?.data ?? [];
  const detail = items.find((i) => i.id === selected) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={category} onValueChange={(v) => setCategory(v as InspirationCategory | typeof CATEGORY_ALL)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CATEGORY_ALL}>All categories</SelectItem>
            {INSPIRATION_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {INSPIRATION_CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant={pinnedOnly ? 'secondary' : 'outline'} size="sm" onClick={() => setPinnedOnly((v) => !v)}>
          <Pin className="h-3.5 w-3.5" /> Pinned
        </Button>
        <Button size="sm" className="ms-auto" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Save trend
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="Nothing saved yet"
          description="Drop a link to a competitor ad, a trending format, or a technique worth remembering."
          action={
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Save trend
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <InspirationCard key={item.id} item={item} onOpen={() => setSelected(item.id)} />
          ))}
        </div>
      )}

      <AddInspirationDialog brands={brands} open={addOpen} onOpenChange={setAddOpen} />

      <Sheet open={detail !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="overflow-y-auto p-6">
          {detail && <InspirationDetail item={detail} onClose={() => setSelected(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
