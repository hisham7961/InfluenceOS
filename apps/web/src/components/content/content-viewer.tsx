'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity as ActivityIcon,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Pencil,
  Pin,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { ContentViewerStateDTO, PublishedContentDTO } from '@influenceos/contracts';
import { UsageRightDialog } from '@/components/usage-rights/usage-right-dialog';
import { contentReviewStatus } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { ContentStatusBadge } from '@/components/ui/status-badges';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { SocialContentPlayer } from './social-content-player';
import { EnterMetricsDialog, invalidateMetricQueries } from './enter-metrics-dialog';
import { DeleteContentDialog, EditCaptionDialog } from './content-actions';
import { ContentAssociationPanel } from './association-panel';
import { CommentThread } from '@/components/collaboration/comment-thread';
import { ActivityFeed } from '@/components/common/activity-feed';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { formatCompact, useLocalizedFormat } from '@/lib/format';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';

const EMPTY_STATE: ContentViewerStateDTO = { firstSeenAt: null, lastOpenedAt: null, reviewedAt: null, savedForLaterAt: null };


function invalidateReviewQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({
    predicate: (q) => {
      const root = q.queryKey[0];
      return root === 'content-feed' || root === 'content-summary' || root === 'dashboard-global' || root === 'influencer-activity';
    },
  });
}

/**
 * The ONE Content Viewer, reused everywhere content opens (Live Content,
 * Mission Control's What's New/Review New Content, Campaign, Influencer,
 * Brand). Owns per-item view-state locally (seeded from whatever `items`
 * carried in) so New/Seen/Reviewed badges update instantly inside the
 * dialog; explicit review-state changes also invalidate the feed/summary
 * queries so the grid behind it catches up. Opening an item always marks it
 * Seen — for the CURRENT USER only (UserContentState is per-user) — never
 * Reviewed, and never logged to the shared ActivityLog (that would be noise
 * for every passive open).
 */
export function ContentViewer({
  items,
  index,
  onIndexChange,
  open,
  onOpenChange,
  reviewMode = false,
  reviewProgress,
}: {
  items: PublishedContentDTO[];
  index: number;
  onIndexChange: (i: number) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Review Mode (item 28-31): shows review progress and auto-advances to the next unreviewed item after "Mark Reviewed". */
  reviewMode?: boolean;
  /** Optional externally-tracked "N of M reviewed" — falls back to counting `items` locally. */
  reviewProgress?: { done: number; total: number };
}) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const [localState, setLocalState] = React.useState<Record<string, ContentViewerStateDTO>>({});
  // The Mark Reviewed button flips its label optimistically (before the PATCH
  // resolves) so it feels instant, but any caller that treats the label
  // change as "the server now has this" — including a browser test — needs a
  // real signal for when the write actually lands. Tracks whichever call
  // (Mark Reviewed / Review Later) is in flight; the button stays disabled
  // until it resolves.
  const [busy, setBusy] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [captionOpen, setCaptionOpen] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [rightsOpen, setRightsOpen] = React.useState(false);
  const raw = items[index];
  const content: PublishedContentDTO | undefined = raw
    ? { ...raw, viewerState: localState[raw.id] ?? raw.viewerState }
    : undefined;

  const markSeen = React.useCallback((c: PublishedContentDTO) => {
    if (c.viewerState?.firstSeenAt) {
      // Already seen — still bump lastOpenedAt locally, but no need for a
      // fresh network round trip on every re-open in the same session.
      return;
    }
    const now = new Date().toISOString();
    setLocalState((s) => ({ ...s, [c.id]: { ...(s[c.id] ?? c.viewerState ?? EMPTY_STATE), firstSeenAt: now, lastOpenedAt: now } }));
    api.content.updateViewState(c.id, { seen: true }).catch(() => undefined);
  }, []);

  React.useEffect(() => {
    if (!open || !content) return;
    markSeen(content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, content?.id]);

  const setReviewed = React.useCallback(
    async (c: PublishedContentDTO, reviewed: boolean) => {
      const now = new Date().toISOString();
      setLocalState((s) => ({
        ...s,
        [c.id]: { ...(s[c.id] ?? c.viewerState ?? EMPTY_STATE), reviewedAt: reviewed ? now : null },
      }));
      await api.content.updateViewState(c.id, { reviewed });
      invalidateReviewQueries(queryClient);
    },
    [queryClient],
  );

  const setReviewLater = React.useCallback(
    async (c: PublishedContentDTO, saved: boolean) => {
      const now = new Date().toISOString();
      setLocalState((s) => ({
        ...s,
        [c.id]: { ...(s[c.id] ?? c.viewerState ?? EMPTY_STATE), savedForLaterAt: saved ? now : null },
      }));
      await api.content.updateViewState(c.id, { reviewLater: saved });
      invalidateReviewQueries(queryClient);
    },
    [queryClient],
  );

  const effectiveState = React.useCallback(
    (c: PublishedContentDTO) => localState[c.id] ?? c.viewerState ?? null,
    [localState],
  );

  const findNextUnreviewed = React.useCallback(
    (from: number) => {
      for (let i = from + 1; i < items.length; i++) {
        const item = items[i]!;
        if (!effectiveState(item)?.reviewedAt) return i;
      }
      return -1;
    },
    [items, effectiveState],
  );

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      // Arrow keys follow reading direction: in Arabic, ← is "next".
      const rtl = document.documentElement.dir === 'rtl';
      const nextKey = rtl ? 'ArrowLeft' : 'ArrowRight';
      const prevKey = rtl ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === nextKey && index < items.length - 1) onIndexChange(index + 1);
      else if (e.key === prevKey && index > 0) onIndexChange(index - 1);
      else if ((e.key === 'r' || e.key === 'R') && content) {
        void setReviewed(content, !effectiveState(content)?.reviewedAt);
      } else if ((e.key === 's' || e.key === 'S') && content) {
        void setReviewLater(content, !effectiveState(content)?.savedForLaterAt);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, items.length, onIndexChange, content?.id]);

  if (!content) return null;
  const state = effectiveState(content);
  const isReviewed = !!state?.reviewedAt;
  const isSavedForLater = !!state?.savedForLaterAt;
  const progress = reviewProgress ?? {
    done: items.filter((c) => !!effectiveState(c)?.reviewedAt).length,
    total: items.length,
  };

  async function handleMarkReviewed() {
    if (!content) return;
    setBusy(true);
    try {
      await setReviewed(content, !isReviewed);
      if (reviewMode && !isReviewed) {
        const next = findNextUnreviewed(index);
        if (next !== -1) onIndexChange(next);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleReviewLater() {
    if (!content) return;
    setBusy(true);
    try {
      await setReviewLater(content, !isSavedForLater);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!content) return;
    const link = `${window.location.origin}/content/${content.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t('viewer.linkCopied'));
    } catch {
      toast.message(link);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* Capped to the screen: the body scrolls and the action bar stays in view, so a tall vertical
            video can never push Next / Mark reviewed off the bottom (it used to on laptops and phones). */}
        <DialogContent className="flex max-h-[92dvh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">
            {content.caption || content.influencer?.displayName || t('player.embeddedContentTitle')}
          </DialogTitle>
          <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[1.5fr_1fr] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
            <div className="flex items-center justify-center bg-black p-3 lg:p-4">
              <SocialContentPlayer key={content.id} content={content} autoPlay maxHeight="min(70dvh, 720px)" />
            </div>
            <ContentDetails content={content} className="lg:min-h-0 lg:overflow-y-auto" />
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-4 py-2.5">
            <Button
              type="button"
              variant={isReviewed ? 'secondary' : 'outline'}
              size="sm"
              onClick={handleMarkReviewed}
              disabled={busy}
              title={t('reviewMode.markReviewedShortcut')}
            >
              {isReviewed ? <Undo2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
              {isReviewed ? t('reviewMode.markUnreviewed') : t('reviewMode.markReviewed')}
            </Button>
            <Button
              type="button"
              variant={isSavedForLater ? 'secondary' : 'outline'}
              size="sm"
              onClick={handleReviewLater}
              disabled={busy}
              title={t('reviewMode.reviewLaterShortcut')}
            >
              {isSavedForLater ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">
                {isSavedForLater ? t('reviewMode.savedForLater') : t('reviewMode.reviewLater')}
              </span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" aria-label={t('viewer.more')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem asChild>
                  <Link href={`/content/${content.id}`}>
                    <ExternalLink className="h-4 w-4" /> {t('viewer.openDetails')}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copyLink()}>
                  <Copy className="h-4 w-4" /> {t('viewer.copyLink')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setLinkOpen(true)}>
                  <Link2 className="h-4 w-4" /> {t('viewer.editLinks')}
                </DropdownMenuItem>
                {!content.isStory ? (
                  <DropdownMenuItem onSelect={() => setCaptionOpen(true)}>
                    <Pencil className="h-4 w-4" /> {t('editContent.edit')}
                  </DropdownMenuItem>
                ) : null}
                {content.brand ? (
                  <DropdownMenuItem onSelect={() => setRightsOpen(true)}>
                    <ShieldCheck className="h-4 w-4" /> {t('viewer.recordUsageRights')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-danger focus:text-danger">
                  <Trash2 className="h-4 w-4" /> {tCommon('delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="ms-auto flex items-center gap-1">
              {reviewMode ? (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="hidden sm:inline">{t('reviewMode.progress', { done: progress.done, total: progress.total })}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={findNextUnreviewed(index) === -1}
                    onClick={() => {
                      const next = findNextUnreviewed(index);
                      if (next !== -1) onIndexChange(next);
                    }}
                  >
                    <span className="hidden sm:inline">{t('reviewMode.nextUnreviewed')}</span>{' '}
                    <SkipForward className="h-3.5 w-3.5" />
                  </Button>
                </span>
              ) : (
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {t('viewer.indexOfTotal', { index: index + 1, total: items.length })}
                </span>
              )}

              <Button
                variant="ghost"
                size="sm"
                disabled={index <= 0}
                onClick={() => onIndexChange(index - 1)}
                aria-label={tCommon('previous')}
              >
                <ChevronLeft className="rtl:-scale-x-100 h-4 w-4" />{' '}
                <span className="hidden sm:inline">{tCommon('previous')}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={index >= items.length - 1}
                onClick={() => onIndexChange(index + 1)}
                aria-label={tCommon('next')}
              >
                <span className="hidden sm:inline">{tCommon('next')}</span>{' '}
                <ChevronRight className="rtl:-scale-x-100 h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteContentDialog
        content={content}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => onOpenChange(false)}
      />
      <EditCaptionDialog content={content} open={captionOpen} onOpenChange={setCaptionOpen} />
      {content.brand ? (
        <UsageRightDialog
          brandId={content.brand.id}
          defaults={{
            influencerId: content.influencer?.id ?? null,
            influencerName: content.influencer?.displayName ?? null,
            campaignId: content.campaign?.id ?? null,
            campaignName: content.campaign?.name ?? null,
            publishedContentId: content.id,
          }}
          open={rightsOpen}
          onOpenChange={setRightsOpen}
        />
      ) : null}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('associations.title')}</DialogTitle>
            <DialogDescription>{t('viewer.editLinksDescription')}</DialogDescription>
          </DialogHeader>
          <ContentAssociationPanel
            key={content.id}
            content={content}
            startEditing
            bare
            onSaved={() => setLinkOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Prominent pinned-note banner (Operations Intelligence pass, PART 6-7) — a Manager Callout is just a
 *  pinned top-level content note surfaced above the fold, sharing the SAME query cache key CommentThread
 *  below uses, so pinning a note there updates this banner without an extra fetch. */
function ManagerCallout({ contentId }: { contentId: string }) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const thread = useQuery({
    queryKey: ['comment-thread', `content:${contentId}`],
    queryFn: () => api.notes.list({ publishedContentId: contentId }, { limit: 30 }),
  });
  const pinned = thread.data?.data.find((n) => n.pinned && !n.deleted);
  if (!pinned) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-brand/40 bg-brand-soft/40 px-3 py-2 text-sm">
      <Pin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-brand">
          {t('viewer.managerCalloutLabel')} · <BidiText>{pinned.authorName ?? tCommon('unknown')}</BidiText>
        </p>
        <p className="whitespace-pre-wrap text-foreground/90">{pinned.body}</p>
      </div>
    </div>
  );
}

export function ContentDetails({ content: incoming, className }: { content: PublishedContentDTO; className?: string }) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const { dateTime, relativeTime } = useLocalizedFormat();
  // Numbers just typed in show at once, before the list behind the viewer
  // has re-fetched.
  const [saved, setSaved] = React.useState<PublishedContentDTO | null>(null);
  const content =
    saved?.id === incoming.id
      ? { ...incoming, metrics: saved.metrics, lastMetricsSyncAt: saved.lastMetricsSyncAt }
      : incoming;
  const monitoring = useQuery({
    queryKey: ['content', content.id, 'monitoring'],
    queryFn: () => api.content.monitoring(content.id),
  });
  const m = content.metrics;
  const reviewStatus = contentReviewStatus(content.viewerState);

  return (
    <div className={cn('flex flex-col gap-4 p-5', className)}>
      <ManagerCallout contentId={content.id} />

      <div className="flex items-center gap-3">
        <Avatar name={content.influencer?.displayName ?? '—'} src={content.influencer?.avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          {content.influencer ? (
            <Link href={`/influencers/${content.influencer.id}`} className="truncate font-semibold hover:underline">
              <BidiText>{content.influencer.displayName}</BidiText>
            </Link>
          ) : (
            <p className="truncate font-semibold">{enumLabel(tEnums, 'contentAssociationStatus', 'UNASSIGNED')}</p>
          )}
          {content.campaign ? (
            <Link href={`/campaigns/${content.campaign.id}`} className="truncate text-xs text-muted-foreground hover:underline">
              {content.campaign.name}
            </Link>
          ) : content.brand ? (
            <Link href={`/brands/${content.brand.slug}`} className="truncate text-xs text-muted-foreground hover:underline">
              {content.brand.name}
            </Link>
          ) : (
            <p className="truncate text-xs text-muted-foreground">—</p>
          )}
        </div>
        <Badge tone={reviewStatus === 'NEW' ? 'info' : reviewStatus === 'REVIEWED' ? 'success' : 'neutral'}>
          {enumLabel(tEnums, 'contentReviewStatus', reviewStatus)}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PlatformBadge platform={content.platform} withLabel />
        {content.isStory ? <Badge tone="accent">{t('grid.storyBadge')}</Badge> : null}
        <ContentStatusBadge status={content.availabilityStatus} />
        {content.deliverable ? (
          content.campaign ? (
            <Link href={`/campaigns/${content.campaign.id}?tab=submissions`}>
              <Badge tone="accent">{enumLabel(tEnums, 'deliverableType', content.deliverable.type)}</Badge>
            </Link>
          ) : (
            <Badge tone="accent">{enumLabel(tEnums, 'deliverableType', content.deliverable.type)}</Badge>
          )
        ) : null}
      </div>

      {content.caption ? <p className="text-sm text-muted-foreground">{content.caption}</p> : null}

      <div className="grid grid-cols-2 gap-2">
        <Stat label={t('viewer.stats.views')} value={m?.views} na={tCommon('na')} />
        <Stat label={t('viewer.stats.likes')} value={m?.likes} na={tCommon('na')} />
        <Stat label={t('viewer.stats.comments')} value={m?.comments} na={tCommon('na')} />
        <Stat label={t('viewer.stats.shares')} value={m?.shares} na={tCommon('na')} />
      </div>

      <dl className="space-y-1.5 text-sm">
        <Row label={t('viewer.fields.published')} value={content.publishedAt ? dateTime(content.publishedAt) : '—'} />
        <Row label={t('viewer.fields.detected')} value={dateTime(content.detectedAt)} />
        <Row
          label={t('viewer.fields.lastChecked')}
          value={content.lastCheckedAt ? relativeTime(content.lastCheckedAt) : t('viewer.notYetChecked')}
        />
        {content.nextCheckAt ? (
          <Row label={t('viewer.fields.nextCheck')} value={relativeTime(content.nextCheckAt)} />
        ) : null}
        <Row
          label={t('viewer.fields.metricsSource')}
          value={enumLabel(tEnums, 'dataSource', m?.source ?? content.provenance.source)}
        />
      </dl>

      {monitoring.data && monitoring.data.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface-muted p-3 text-xs">
          <p className="mb-1 font-medium">{t('viewer.recentMonitoring')}</p>
          <p className="text-muted-foreground">
            {monitoring.data[0]!.toStatus ? enumLabel(tEnums, 'contentStatus', monitoring.data[0]!.toStatus!) : '—'} ·{' '}
            {relativeTime(monitoring.data[0]!.checkedAt)}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!content.isStory ? (
          <Button asChild variant="secondary" size="sm" className="flex-1">
            <a href={content.originalUrl} target="_blank" rel="noopener noreferrer">
              {tCommon('openOriginal')} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        ) : null}
        <EnterMetricsDialog content={content} onSaved={setSaved} />
        {!content.isStory ? <RefreshButton id={content.id} onRefreshed={setSaved} /> : null}
      </div>

      {/* Factual system history (ActivityLog) — reuses the SAME ActivityFeed the
          Campaign workspace's Activity tab shows, scoped to this content's own
          events (added, associations changed, availability/status changed).
          Rendered as a shaded panel, distinct from the plain-header Notes/
          CommentThread section below, which is human discussion, not history. */}
      <div className="space-y-2 rounded-lg border border-border bg-surface-muted/40 p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ActivityIcon className="h-3.5 w-3.5" /> {t('viewer.activity')}
        </p>
        <ActivityFeed
          filter={{ publishedContentId: content.id, limit: 20 }}
          queryKey={['content-activity', content.id]}
          emptyTitle={t('viewer.activityEmptyTitle')}
          emptyDescription={t('viewer.activityEmptyDescription')}
        />
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('viewer.notes')}</p>
        <CommentThread
          context={{ publishedContentId: content.id }}
          cacheKey={`content:${content.id}`}
          emptyTitle={t('viewer.notesEmptyTitle')}
          emptyDescription={t('viewer.notesEmptyDescription')}
          composerPlaceholder={t('viewer.notesComposerPlaceholder')}
        />
      </div>
    </div>
  );
}

function RefreshButton({ id, onRefreshed }: { id: string; onRefreshed?: (c: PublishedContentDTO) => void }) {
  const tCommon = useTranslations('common');
  const qc = useQueryClient();
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  async function refresh() {
    setLoading(true);
    try {
      // The result used to be thrown away, so a refresh changed nothing on
      // screen until the page was reloaded.
      const updated = await api.content.refresh(id);
      onRefreshed?.(updated);
      invalidateMetricQueries(qc);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e, tCommon('somethingWentWrong')));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={refresh} disabled={loading} aria-label={tCommon('refresh')}>
      <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
    </Button>
  );
}

function Stat({ label, value, na }: { label: string; value: number | null | undefined; na: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted px-3 py-2">
      <p className="text-lg font-semibold">{value == null ? na : <LtrText>{formatCompact(value)}</LtrText>}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">{value}</dd>
    </div>
  );
}
