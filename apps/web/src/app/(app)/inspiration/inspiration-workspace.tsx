'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ExternalLink, FileText, Lightbulb, Pin, Play, Plus, Trash2, X } from 'lucide-react';
import type { BrandSummaryDTO, InspirationItemDTO } from '@influenceos/contracts';
import { INSPIRATION_CATEGORIES, type InspirationCategory } from '@influenceos/shared';
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
import { useLocalizedFormat } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useApp } from '@/components/shell/app-context';
import { CommentThread } from '@/components/collaboration/comment-thread';
import { SocialContentPlayer } from '@/components/content/social-content-player';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText } from '@/components/common/bidi-text';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

const CATEGORY_ALL = 'ALL';

function AddInspirationDialog({ brands, open, onOpenChange }: { brands: BrandSummaryDTO[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const t = useTranslations('inspiration');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const [url, setUrl] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [note, setNote] = React.useState('');
  const [category, setCategory] = React.useState<InspirationCategory>('TREND');
  const [brandId, setBrandId] = React.useState<string>('');
  const [campaignId, setCampaignId] = React.useState<string>('');
  const [tags, setTags] = React.useState('');

  const campaigns = useQuery({ queryKey: ['campaigns', 'options'], queryFn: () => api.campaigns.list({ pageSize: 100 }) });
  const campaignOptions = (campaigns.data?.data ?? []).filter((c) => !brandId || c.brandId === brandId);

  function reset() {
    setUrl('');
    setTitle('');
    setNote('');
    setCategory('TREND');
    setBrandId('');
    setCampaignId('');
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
        campaignId: campaignId || undefined,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toast.success(t('addDialog.savedToast'));
      reset();
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ['inspiration'] });
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addDialog.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('addDialog.linkLabel')}>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('addDialog.linkPlaceholder')} autoFocus />
          </Field>
          <Field label={t('addDialog.titleLabel')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('addDialog.titlePlaceholder')} />
          </Field>
          <Field label={t('addDialog.noteLabel')}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('addDialog.categoryLabel')}>
              <Select value={category} onValueChange={(v) => setCategory(v as InspirationCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INSPIRATION_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {enumLabel(tEnums, 'inspirationCategory', c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('addDialog.brandLabel')}>
              <Select
                value={brandId || CATEGORY_ALL}
                onValueChange={(v) => {
                  setBrandId(v === CATEGORY_ALL ? '' : v);
                  setCampaignId('');
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CATEGORY_ALL}>{t('none')}</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={t('addDialog.campaignLabel')} hint={t('addDialog.campaignHint')}>
            <Select value={campaignId || CATEGORY_ALL} onValueChange={(v) => setCampaignId(v === CATEGORY_ALL ? '' : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CATEGORY_ALL}>{t('none')}</SelectItem>
                {campaignOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('addDialog.tagsLabel')}>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('addDialog.tagsPlaceholder')} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={!url.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? tCommon('saving') : tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InspirationCard({ item, onOpen }: { item: InspirationItemDTO; onOpen: () => void }) {
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const { relativeTime } = useLocalizedFormat();
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="flex cursor-pointer flex-col gap-2 overflow-hidden p-4 transition-shadow hover:shadow-pop"
    >
      {item.thumbnailUrl ? (
        <div className="relative -mx-4 -mt-4 aspect-video overflow-hidden bg-gradient-to-br from-neutral-800 to-neutral-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          {(item.platform ?? item.embed?.platform) ? (
            <div className="absolute start-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 backdrop-blur">
              <PlatformIcon platform={(item.platform ?? item.embed?.platform)!} className="h-3 w-3 text-white" />
            </div>
          ) : null}
          {item.embeddable ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/10">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-black shadow-pop">
                <Play className="h-4 w-4 fill-current" />
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <Badge tone="accent">{enumLabel(tEnums, 'inspirationCategory', item.category)}</Badge>
        {item.pinned && <Pin className="h-4 w-4 shrink-0 text-brand" />}
      </div>
      <p className="line-clamp-2 font-medium">{item.title ?? item.url}</p>
      {item.note ? <p className="line-clamp-3 text-sm text-muted-foreground">{item.note}</p> : null}
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.slice(0, 4).map((tag) => (
            <Badge key={tag} tone="neutral" className="text-[10px]">
              #{tag}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between pt-1 text-xs text-muted-foreground">
        <span>{item.brandName ?? tCommon('allBrands')}</span>
        <span>{relativeTime(item.createdAt)}</span>
      </div>
    </Card>
  );
}

function ScriptLinkPicker({ item }: { item: InspirationItemDTO }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const t = useTranslations('inspiration');
  const tCommon = useTranslations('common');
  const scripts = useQuery({
    queryKey: ['campaign-scripts', item.campaignId],
    queryFn: () => api.campaigns.scripts(item.campaignId!),
    enabled: open,
  });

  const link = useMutation({
    mutationFn: (scriptReferenceId: string | null) => api.inspiration.update(item.id, { scriptReferenceId }),
    onSuccess: () => {
      toast.success(item.scriptReferenceId ? t('script.unlinkedToast') : t('script.linkedToast'));
      queryClient.invalidateQueries({ queryKey: ['inspiration'] });
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  if (item.scriptReferenceId) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        <Link href={`/campaigns/${item.campaignId}?tab=scripts`} className="text-brand hover:underline">
          {item.scriptReferenceTitle ?? t('script.linkedFallback')}
        </Link>
        <Button variant="ghost" size="icon-sm" title={t('script.unlink')} disabled={link.isPending} onClick={() => link.mutate(null)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  if (!item.campaignId) return null;

  return (
    <div className="relative">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
        <FileText className="h-3.5 w-3.5" /> {t('script.link')}
      </Button>
      {open ? (
        <div className="absolute z-10 mt-1 w-64 rounded-lg border border-border bg-card p-1 shadow-card">
          {scripts.isLoading ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{tCommon('loading')}</p>
          ) : (scripts.data ?? []).length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('script.noScriptsYet')}</p>
          ) : (
            (scripts.data ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => link.mutate(s.id)}
                disabled={link.isPending}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-muted"
              >
                {s.title}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function InspirationDetail({ item, onClose }: { item: InspirationItemDTO; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user } = useApp();
  const canModify = user.role === 'ADMIN' || item.submittedById === user.id;
  const t = useTranslations('inspiration');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const { relativeTime } = useLocalizedFormat();

  const togglePin = useMutation({
    mutationFn: () => api.inspiration.update(item.id, { pinned: !item.pinned }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inspiration'] }),
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const remove = useMutation({
    mutationFn: () => api.inspiration.remove(item.id),
    onSuccess: () => {
      toast.success(t('detail.removedToast'));
      queryClient.invalidateQueries({ queryKey: ['inspiration'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Badge tone="accent">{enumLabel(tEnums, 'inspirationCategory', item.category)}</Badge>
          <h2 className="mt-2 text-lg font-semibold">{item.title ?? t('detail.untitled')}</h2>
          <p className="text-xs text-muted-foreground">
            {t.rich('detail.savedBy', { value: item.submittedByName ?? tCommon('unknown'), name: (chunks) => <BidiText>{chunks}</BidiText> })} ·{' '}
            {relativeTime(item.createdAt)}
            {item.campaignName ? ` · ${item.campaignName}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            title={item.pinned ? t('detail.unpin') : t('detail.pin')}
            disabled={togglePin.isPending}
            onClick={() => togglePin.mutate()}
          >
            <Pin className={cn('h-4 w-4', item.pinned && 'text-brand')} />
          </Button>
          {canModify && (
            <Button variant="ghost" size="icon-sm" title={tCommon('remove')} disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 className="h-4 w-4 text-danger" />
            </Button>
          )}
        </div>
      </div>

      {item.embeddable ? (
        <SocialContentPlayer
          content={{
            platform: item.platform,
            embed: item.embed,
            thumbnailUrl: item.thumbnailUrl,
            caption: item.title,
            originalUrl: item.url,
          }}
        />
      ) : null}

      <Button asChild variant="secondary" size="sm">
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          {tCommon('openOriginal')} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Button>

      {item.note ? <p className="whitespace-pre-wrap text-sm text-foreground/90">{item.note}</p> : null}

      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <Badge key={tag} tone="neutral">
              #{tag}
            </Badge>
          ))}
        </div>
      )}

      {item.campaignId ? <ScriptLinkPicker item={item} /> : null}

      <div className="border-t border-border pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('detail.discussion')}</p>
        <CommentThread
          context={{ inspirationItemId: item.id }}
          cacheKey={`inspiration:${item.id}`}
          emptyTitle={t('detail.noCommentsYet')}
          emptyDescription={t('detail.commentsEmptyDescription')}
          composerPlaceholder={t('detail.commentsComposerPlaceholder')}
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
  const t = useTranslations('inspiration');
  const tEnums = useTranslations('enums');

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
            <SelectItem value={CATEGORY_ALL}>{t('filters.allCategories')}</SelectItem>
            {INSPIRATION_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {enumLabel(tEnums, 'inspirationCategory', c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant={pinnedOnly ? 'secondary' : 'outline'} size="sm" onClick={() => setPinnedOnly((v) => !v)}>
          <Pin className="h-3.5 w-3.5" /> {t('filters.pinnedOnly')}
        </Button>
        <Button size="sm" className="ms-auto" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> {t('actions.saveTrend')}
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> {t('actions.saveTrend')}
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
