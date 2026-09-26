'use client';
import { useTranslations } from 'next-intl';
import { Check, Film, Heart, MessageCircle, MessageSquare, Play, Eye } from 'lucide-react';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { contentReviewStatus } from '@influenceos/shared';
import { formatCompact, useLocalizedFormat } from '@/lib/format';
import { enumLabel } from '@/lib/enum-labels';
import { toBrowserUrl } from '@/lib/upload';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { ContentStatusBadge } from '@/components/ui/status-badges';
import { Avatar } from '@/components/ui/avatar';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { cn } from '@/lib/cn';

export const ALERT_STATUSES = new Set(['REMOVED', 'PRIVATE', 'UNAVAILABLE', 'BROKEN_LINK']);

/**
 * Media-first card — thumbnail dominates, everything else is a light overlay
 * or a single compact row underneath. New/Seen/Reviewed come from the SAME
 * derived contentReviewStatus() used by the Viewer, filter chips and daily
 * summary — never a separate per-card computation.
 */
export function ContentCard({ content, onOpen }: { content: PublishedContentDTO; onOpen: () => void }) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const { relativeTime } = useLocalizedFormat();
  const m = content.metrics;
  const reviewStatus = contentReviewStatus(content.viewerState);
  const isAlert = ALERT_STATUSES.has(content.availabilityStatus);
  // A Story never has a public thumbnailUrl (no provider to derive one from)
  // — an uploaded screenshot shows its own image directly; an uploaded video
  // falls back to the same platform-icon placeholder as any content without
  // a thumbnail, since there's no cheap way to derive a video's first frame.
  const storyImageSrc =
    content.isStory && content.storyMedia?.kind === 'image' ? toBrowserUrl(content.storyMedia.url) : null;
  const showPlayOverlay = content.embeddable || (content.isStory && content.storyMedia?.kind === 'video');

  return (
    <button
      onClick={onOpen}
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl border bg-card text-start shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop',
        reviewStatus === 'SEEN' ? 'border-border/70' : 'border-border',
      )}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-gradient-to-br from-neutral-800 to-neutral-900">
        {storyImageSrc || content.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={storyImageSrc ?? content.thumbnailUrl!}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn(
              'h-full w-full object-cover transition-transform duration-300 group-hover:scale-105',
              reviewStatus === 'SEEN' && 'opacity-90',
            )}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {content.isStory ? (
              <Film className="h-12 w-12 text-white/30" />
            ) : (
              <PlatformIcon platform={content.platform} className="h-12 w-12 text-white/30" />
            )}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="absolute start-3 top-3 flex items-center gap-1.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/40 backdrop-blur">
            <PlatformIcon platform={content.platform} className="h-3.5 w-3.5 text-white" />
          </span>
          {content.isStory ? (
            <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">
              {t('grid.storyBadge')}
            </span>
          ) : null}
          {reviewStatus === 'NEW' ? (
            <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-foreground shadow-sm">
              {enumLabel(tEnums, 'contentReviewStatus', 'NEW')}
            </span>
          ) : reviewStatus === 'REVIEWED' ? (
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/40 text-success backdrop-blur"
              aria-label={enumLabel(tEnums, 'contentReviewStatus', 'REVIEWED')}
            >
              <Check className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </div>
        <div className="absolute end-3 top-3 flex items-center gap-1.5">
          {content.commentCount > 0 ? (
            <span
              className="flex h-6 items-center gap-1 rounded-full bg-black/40 px-2 text-[11px] font-medium text-white backdrop-blur"
              aria-label={t('grid.hasCommentsAriaLabel')}
              title={t('grid.hasCommentsAriaLabel')}
            >
              <MessageSquare className="h-3 w-3" />
              {content.commentCount}
            </span>
          ) : null}
          {isAlert ? <ContentStatusBadge status={content.availabilityStatus} /> : null}
        </div>
        {showPlayOverlay && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-pop">
              <Play className="h-5 w-5 fill-current" />
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <Avatar name={content.influencer?.displayName ?? tCommon('unknown')} src={content.influencer?.avatarUrl} size="xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {content.influencer ? (
                <BidiText>{content.influencer.displayName}</BidiText>
              ) : (
                enumLabel(tEnums, 'contentAssociationStatus', 'UNASSIGNED')
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">{content.campaign?.name ?? content.brand?.name ?? '—'}</p>
          </div>
        </div>
        {content.caption ? <p className="line-clamp-1 text-xs text-muted-foreground">{content.caption}</p> : null}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {m ? (
            <>
              <Metric icon={Eye} value={m.views} na={tCommon('na')} />
              <Metric icon={Heart} value={m.likes} na={tCommon('na')} />
              <Metric icon={MessageCircle} value={m.comments} na={tCommon('na')} />
            </>
          ) : (
            // No numbers at all yet — typically Snapchat, TikTok or a Story,
            // which have to be typed in (open the post → Enter metrics).
            <span className="rounded-full bg-warning/10 px-2 py-0.5 font-medium text-warning">{t('metricsEntry.missingChip')}</span>
          )}
          <span className="ms-auto">{relativeTime(content.publishedAt ?? content.detectedAt)}</span>
        </div>
      </div>
    </button>
  );
}

function Metric({
  icon: Icon,
  value,
  na,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number | null | undefined;
  na: string;
}) {
  return (
    <span className={cn('flex items-center gap-1', value == null && 'opacity-50')}>
      <Icon className="h-3.5 w-3.5" />
      {value == null ? na : <LtrText>{formatCompact(value)}</LtrText>}
    </span>
  );
}
