import Link from 'next/link';
import { MapPin } from 'lucide-react';
import type { InfluencerSummaryDTO } from '@influenceos/contracts';
import { Avatar } from '@/components/ui/avatar';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { AudienceHealthBadge, RelationshipStatusBadge } from '@/components/ui/status-badges';
import { Badge } from '@/components/ui/badge';
import { formatCompact } from '@/lib/format';

export function InfluencerCard({ influencer }: { influencer: InfluencerSummaryDTO }) {
  return (
    <Link
      href={`/influencers/${influencer.id}`}
      className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop"
    >
      <div className="flex items-start gap-3">
        <Avatar name={influencer.displayName} src={influencer.avatarUrl} size="lg" rounded="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{influencer.displayName}</p>
          {influencer.primaryUsername ? (
            <p className="truncate text-sm text-muted-foreground">@{influencer.primaryUsername}</p>
          ) : null}
          <div className="mt-1.5 flex items-center gap-1.5">
            {influencer.followersByPlatform.slice(0, 4).map((f) => (
              <span key={f.platform} className="flex items-center gap-1 text-xs text-muted-foreground">
                <PlatformIcon platform={f.platform} className="h-3.5 w-3.5" />
                {f.followers != null ? formatCompact(f.followers) : '—'}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <RelationshipStatusBadge status={influencer.relationshipStatus} />
        <AudienceHealthBadge label={influencer.audienceHealth} />
      </div>

      <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {influencer.country ? (
            <>
              <MapPin className="h-3.5 w-3.5" /> {influencer.country}
            </>
          ) : (
            influencer.category ?? '—'
          )}
        </span>
        {influencer.totalFollowers != null ? (
          <Badge tone="neutral">{formatCompact(influencer.totalFollowers)} total</Badge>
        ) : null}
      </div>
    </Link>
  );
}
