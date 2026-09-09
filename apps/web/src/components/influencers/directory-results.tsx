'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Eye, LayoutGrid, List as ListIcon, MapPin, Table as TableIcon } from 'lucide-react';
import type { InfluencerSummaryDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { InfluencerCard } from '@/components/influencers/influencer-card';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { AudienceHealthBadge, RelationshipStatusBadge } from '@/components/ui/status-badges';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatCompact } from '@/lib/format';
import { cn } from '@/lib/cn';

type ViewMode = 'cards' | 'list' | 'table';
const STORAGE_KEY = 'influenceos.directory.view';

const VIEWS: { mode: ViewMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { mode: 'cards', label: 'Cards', icon: LayoutGrid },
  { mode: 'list', label: 'List', icon: ListIcon },
  { mode: 'table', label: 'Table', icon: TableIcon },
];

/**
 * Influencer directory with three interchangeable density views (cards / list /
 * table) and an in-place quick-preview drawer that pulls the 360 profile
 * without leaving the directory. The chosen view persists per viewer.
 */
export function DirectoryResults({ influencers }: { influencers: InfluencerSummaryDTO[] }) {
  const [view, setView] = React.useState<ViewMode>('cards');
  const [previewId, setPreviewId] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ViewMode | null;
      if (saved === 'cards' || saved === 'list' || saved === 'table') setView(saved);
    } catch {
      /* ignore */
    }
  }, []);

  function choose(mode: ViewMode) {
    setView(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <div className="inline-flex rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Directory view">
          {VIEWS.map(({ mode, label, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={view === mode}
              onClick={() => choose(mode)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                view === mode ? 'bg-brand text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {view === 'cards' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {influencers.map((influencer) => (
            <InfluencerCard key={influencer.id} influencer={influencer} />
          ))}
        </div>
      ) : view === 'list' ? (
        <div className="space-y-2">
          {influencers.map((inf) => (
            <ListRow key={inf.id} inf={inf} onPreview={() => setPreviewId(inf.id)} />
          ))}
        </div>
      ) : (
        <DirectoryTable influencers={influencers} onPreview={setPreviewId} />
      )}

      <PreviewDrawer influencerId={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}

function ListRow({ inf, onPreview }: { inf: InfluencerSummaryDTO; onPreview: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <Avatar name={inf.displayName} src={inf.avatarUrl} size="md" rounded="lg" />
      <div className="min-w-0 flex-1">
        <Link href={`/influencers/${inf.id}`} className="truncate font-semibold hover:underline">
          {inf.displayName}
        </Link>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {inf.primaryUsername ? <span className="truncate">@{inf.primaryUsername}</span> : null}
          {inf.country ? (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {inf.country}
            </span>
          ) : null}
        </div>
      </div>
      <div className="hidden items-center gap-1.5 md:flex">
        {inf.followersByPlatform.slice(0, 3).map((f) => (
          <span key={f.platform} className="flex items-center gap-1 text-xs text-muted-foreground">
            <PlatformIcon platform={f.platform} className="h-3.5 w-3.5" />
            {f.followers != null ? formatCompact(f.followers) : '—'}
          </span>
        ))}
      </div>
      <RelationshipStatusBadge status={inf.relationshipStatus} />
      <AudienceHealthBadge status={inf.audienceHealth} />
      {inf.totalFollowers != null ? (
        <Badge tone="neutral" className="hidden lg:inline-flex">
          {formatCompact(inf.totalFollowers)}
        </Badge>
      ) : null}
      <Button type="button" variant="ghost" size="sm" onClick={onPreview} aria-label={`Preview ${inf.displayName}`}>
        <Eye className="h-4 w-4" />
      </Button>
    </div>
  );
}

function DirectoryTable({
  influencers,
  onPreview,
}: {
  influencers: InfluencerSummaryDTO[];
  onPreview: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">Influencer</th>
            <th className="px-4 py-3 font-medium">Platform</th>
            <th className="px-4 py-3 font-medium">Country</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Audience</th>
            <th className="px-4 py-3 text-right font-medium">Followers</th>
            <th className="px-4 py-3 text-right font-medium">Campaigns</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {influencers.map((inf) => (
            <tr key={inf.id} className="hover:bg-surface-muted/50">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <Avatar name={inf.displayName} src={inf.avatarUrl} size="xs" />
                  <Link href={`/influencers/${inf.id}`} className="font-medium hover:underline">
                    {inf.displayName}
                  </Link>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  {inf.platforms.slice(0, 4).map((p) => (
                    <PlatformIcon key={p} platform={p} className="h-4 w-4 text-muted-foreground" />
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{inf.country ?? '—'}</td>
              <td className="px-4 py-3">
                <RelationshipStatusBadge status={inf.relationshipStatus} />
              </td>
              <td className="px-4 py-3">
                <AudienceHealthBadge status={inf.audienceHealth} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {inf.totalFollowers != null ? formatCompact(inf.totalFollowers) : '—'}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{inf.activeCampaigns}</td>
              <td className="px-4 py-3 text-right">
                <Button type="button" variant="ghost" size="sm" onClick={() => onPreview(inf.id)} aria-label={`Preview ${inf.displayName}`}>
                  <Eye className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewDrawer({ influencerId, onClose }: { influencerId: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['influencer-preview', influencerId],
    queryFn: () => api.influencers.get(influencerId as string),
    enabled: Boolean(influencerId),
  });

  return (
    <Sheet open={Boolean(influencerId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        {isLoading || !data ? (
          <div className="space-y-4">
            <Skeleton className="h-16 w-16 rounded-2xl" />
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : (
          <div className="space-y-5">
            <SheetHeader className="space-y-3 text-left">
              <div className="flex items-center gap-3">
                <Avatar name={data.displayName} src={data.avatarUrl} size="lg" rounded="lg" />
                <div className="min-w-0">
                  <SheetTitle className="truncate">{data.displayName}</SheetTitle>
                  {data.primaryUsername ? (
                    <SheetDescription className="truncate">@{data.primaryUsername}</SheetDescription>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <RelationshipStatusBadge status={data.relationshipStatus} />
                <AudienceHealthBadge status={data.audienceHealth} />
                {data.country ? <Badge tone="neutral">{data.country}</Badge> : null}
              </div>
            </SheetHeader>

            {data.bio ? <p className="text-sm leading-relaxed text-muted-foreground">{data.bio}</p> : null}

            <div className="grid grid-cols-2 gap-3">
              <Stat label="Total followers" value={data.totalFollowers != null ? formatCompact(data.totalFollowers) : '—'} />
              <Stat label="Active campaigns" value={String(data.activeCampaigns)} />
              <Stat label="Campaigns (all-time)" value={String(data.history?.campaignCount ?? 0)} />
              <Stat label="Accounts" value={String(data.socialAccounts?.length ?? 0)} />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Platforms</p>
              <div className="flex flex-wrap gap-2">
                {data.followersByPlatform.map((f) => (
                  <span key={f.platform} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs">
                    <PlatformIcon platform={f.platform} className="h-4 w-4" />
                    {f.followers != null ? formatCompact(f.followers) : '—'}
                  </span>
                ))}
              </div>
            </div>

            <Button asChild className="w-full">
              <Link href={`/influencers/${data.id}`}>View full 360 profile</Link>
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
