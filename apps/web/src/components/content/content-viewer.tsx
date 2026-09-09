'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { ContentStatusBadge } from '@/components/ui/status-badges';
import { Avatar } from '@/components/ui/avatar';
import { SocialContentPlayer } from './social-content-player';
import { dateTime, formatCompact, relativeTime } from '@/lib/format';

export function ContentViewer({
  items,
  index,
  onIndexChange,
  open,
  onOpenChange,
}: {
  items: PublishedContentDTO[];
  index: number;
  onIndexChange: (i: number) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const content = items[index];

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, items.length, onIndexChange]);

  if (!content) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl gap-0 overflow-hidden p-0">
        <div className="grid lg:grid-cols-[1.5fr_1fr]">
          <div className="bg-black p-3 lg:p-4">
            <SocialContentPlayer key={content.id} content={content} autoPlay />
          </div>
          <ContentDetails content={content} />
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
          <Button variant="ghost" size="sm" disabled={index <= 0} onClick={() => onIndexChange(index - 1)}>
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            {index + 1} of {items.length}
          </span>
          <Button variant="ghost" size="sm" disabled={index >= items.length - 1} onClick={() => onIndexChange(index + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContentDetails({ content }: { content: PublishedContentDTO }) {
  const monitoring = useQuery({
    queryKey: ['content', content.id, 'monitoring'],
    queryFn: () => api.content.monitoring(content.id),
  });
  const m = content.metrics;

  return (
    <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center gap-3">
        <Avatar name={content.influencer?.displayName ?? '—'} src={content.influencer?.avatarUrl} size="md" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{content.influencer?.displayName ?? 'Unassigned'}</p>
          <p className="truncate text-xs text-muted-foreground">{content.campaign?.name ?? content.brand?.name ?? '—'}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PlatformBadge platform={content.platform} withLabel />
        <ContentStatusBadge status={content.availabilityStatus} />
      </div>

      {content.caption ? <p className="text-sm text-muted-foreground">{content.caption}</p> : null}

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Views" value={m?.views} />
        <Stat label="Likes" value={m?.likes} />
        <Stat label="Comments" value={m?.comments} />
        <Stat label="Shares" value={m?.shares} />
      </div>

      <dl className="space-y-1.5 text-sm">
        <Row label="Published" value={content.publishedAt ? dateTime(content.publishedAt) : '—'} />
        <Row label="Detected" value={dateTime(content.detectedAt)} />
        <Row label="Last checked" value={content.lastCheckedAt ? relativeTime(content.lastCheckedAt) : 'Not yet'} />
        <Row label="Metrics source" value={m?.source ?? content.provenance.source} />
      </dl>

      {monitoring.data && monitoring.data.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface-muted p-3 text-xs">
          <p className="mb-1 font-medium">Recent monitoring</p>
          <p className="text-muted-foreground">
            {monitoring.data[0]!.toStatus ?? '—'} · {relativeTime(monitoring.data[0]!.checkedAt)}
          </p>
        </div>
      ) : null}

      <div className="mt-auto flex gap-2">
        <Button asChild variant="secondary" size="sm" className="flex-1">
          <a href={content.originalUrl} target="_blank" rel="noopener noreferrer">
            Open original <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
        <RefreshButton id={content.id} />
      </div>
    </div>
  );
}

function RefreshButton({ id }: { id: string }) {
  const [loading, setLoading] = React.useState(false);
  async function refresh() {
    setLoading(true);
    try {
      await api.content.refresh(id);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={refresh} disabled={loading} aria-label="Refresh">
      <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
    </Button>
  );
}

function Stat({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted px-3 py-2">
      <p className="text-lg font-semibold">{value == null ? 'N/A' : formatCompact(value)}</p>
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
