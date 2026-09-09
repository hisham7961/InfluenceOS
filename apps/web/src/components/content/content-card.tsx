'use client';
import { Heart, MessageCircle, Play, Eye } from 'lucide-react';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { formatCompact } from '@/lib/format';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { ContentStatusBadge } from '@/components/ui/status-badges';
import { Avatar } from '@/components/ui/avatar';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

export function ContentCard({ content, onOpen }: { content: PublishedContentDTO; onOpen: () => void }) {
  const m = content.metrics;
  return (
    <button
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-start shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-gradient-to-br from-neutral-800 to-neutral-900">
        {content.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={content.thumbnailUrl} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <PlatformIcon platform={content.platform} className="h-12 w-12 text-white/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="absolute left-3 top-3 flex items-center gap-1.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/40 backdrop-blur">
            <PlatformIcon platform={content.platform} className="h-3.5 w-3.5 text-white" />
          </span>
        </div>
        <div className="absolute right-3 top-3">
          <ContentStatusBadge status={content.availabilityStatus} />
        </div>
        {content.embeddable && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-pop">
              <Play className="h-5 w-5 fill-current" />
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <Avatar name={content.influencer?.displayName ?? 'Unknown'} src={content.influencer?.avatarUrl} size="xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{content.influencer?.displayName ?? 'Unassigned'}</p>
            <p className="truncate text-xs text-muted-foreground">{content.campaign?.name ?? content.brand?.name ?? '—'}</p>
          </div>
        </div>
        {content.caption ? <p className="line-clamp-1 text-xs text-muted-foreground">{content.caption}</p> : null}
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
