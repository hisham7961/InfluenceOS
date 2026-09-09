'use client';
import * as React from 'react';
import { Eye, Heart, MessageCircle, Play } from 'lucide-react';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { cn } from '@/lib/cn';
import { formatCompact, relativeTime } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { ContentStatusBadge } from '@/components/ui/status-badges';
import { ContentViewer } from './content-viewer';

/**
 * Pinterest-style masonry wall. Unlike the uniform grid, tiles keep their
 * media's natural aspect ratio and flow into balanced CSS columns, so a wall of
 * mixed portrait/landscape/square content reads like a real discovery feed.
 * `break-inside: avoid` keeps each card intact across column breaks.
 */
export function ContentMasonry({ items }: { items: PublishedContentDTO[] }) {
  const [index, setIndex] = React.useState(0);
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <div className="[column-fill:_balance] columns-2 gap-4 sm:columns-3 lg:columns-4 xl:columns-5">
        {items.map((content, i) => (
          <MasonryCard
            key={content.id}
            content={content}
            onOpen={() => {
              setIndex(i);
              setOpen(true);
            }}
          />
        ))}
      </div>
      <ContentViewer items={items} index={index} onIndexChange={setIndex} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Deterministic pseudo-aspect for tiles with no thumbnail, so the wall still
 *  staggers instead of collapsing into equal-height blocks. */
const FALLBACK_ASPECTS = ['aspect-square', 'aspect-[4/5]', 'aspect-[3/4]', 'aspect-video'];

function MasonryCard({ content, onOpen }: { content: PublishedContentDTO; onOpen: () => void }) {
  const m = content.metrics;
  const fallback = FALLBACK_ASPECTS[hashId(content.id) % FALLBACK_ASPECTS.length];

  return (
    <button
      onClick={onOpen}
      className="group mb-4 flex w-full break-inside-avoid flex-col overflow-hidden rounded-2xl border border-border bg-card text-start shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop"
    >
      <div className="relative w-full overflow-hidden bg-gradient-to-br from-neutral-800 to-neutral-900">
        {content.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={content.thumbnailUrl}
            alt=""
            loading="lazy"
            className="w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className={cn('flex w-full items-center justify-center', fallback)}>
            <PlatformIcon platform={content.platform} className="h-12 w-12 text-white/30" />
          </div>
        )}
        <div className="absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 backdrop-blur">
          <PlatformIcon platform={content.platform} className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="absolute right-3 top-3">
          <ContentStatusBadge status={content.availabilityStatus} />
        </div>
        {content.embeddable ? (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-pop">
              <Play className="h-5 w-5 fill-current" />
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <Avatar name={content.influencer?.displayName ?? 'Unknown'} src={content.influencer?.avatarUrl} size="xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{content.influencer?.displayName ?? 'Unassigned'}</p>
            <p className="truncate text-xs text-muted-foreground">{content.campaign?.name ?? content.brand?.name ?? '—'}</p>
          </div>
        </div>
        {content.caption ? <p className="line-clamp-2 text-xs text-muted-foreground">{content.caption}</p> : null}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Metric icon={Eye} value={m?.views} />
          <Metric icon={Heart} value={m?.likes} />
          <Metric icon={MessageCircle} value={m?.comments} />
          <span className="ms-auto">{relativeTime(content.publishedAt ?? content.detectedAt)}</span>
        </div>
      </div>
    </button>
  );
}

function Metric({ icon: Icon, value }: { icon: React.ComponentType<{ className?: string }>; value: number | null | undefined }) {
  return (
    <span className={cn('flex items-center gap-1', value == null && 'opacity-50')}>
      <Icon className="h-3.5 w-3.5" />
      {value == null ? 'N/A' : formatCompact(value)}
    </span>
  );
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
