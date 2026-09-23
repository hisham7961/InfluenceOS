'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Film, MapPin, Megaphone } from 'lucide-react';
import type { InfluencerSummaryDTO } from '@influenceos/contracts';
import { Avatar } from '@/components/ui/avatar';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { AudienceHealthBadge, RelationshipStatusBadge } from '@/components/ui/status-badges';
import { Badge } from '@/components/ui/badge';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { formatCompact } from '@/lib/format';

export function InfluencerCard({ influencer }: { influencer: InfluencerSummaryDTO }) {
  const t = useTranslations('influencers');
  return (
    <Link
      href={`/influencers/${influencer.id}`}
      className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop"
    >
      <div className="flex items-start gap-3">
        <Avatar name={influencer.displayName} src={influencer.avatarUrl} size="lg" rounded="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            <BidiText>{influencer.displayName}</BidiText>
          </p>
          {influencer.primaryUsername ? (
            <p className="truncate text-sm text-muted-foreground">
              <LtrText>@{influencer.primaryUsername}</LtrText>
            </p>
          ) : null}
          <div className="mt-1.5 flex items-center gap-1.5">
            {influencer.followersByPlatform.slice(0, 4).map((f) => (
              <span key={f.platform} className="flex items-center gap-1 text-xs text-muted-foreground">
                <PlatformIcon platform={f.platform} className="h-3.5 w-3.5" />
                {f.followers != null ? <LtrText>{formatCompact(f.followers)}</LtrText> : '—'}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <RelationshipStatusBadge status={influencer.relationshipStatus} />
        <AudienceHealthBadge status={influencer.audienceHealth} />
      </div>

      {influencer.contentCount > 0 || influencer.activeCampaignNames.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {influencer.contentCount > 0 ? (
            <Badge tone="neutral" className="gap-1">
              <Film className="h-3 w-3" />
              {t('directory.results.contentCountBadge', { count: influencer.contentCount })}
            </Badge>
          ) : null}
          {influencer.activeCampaignNames.slice(0, 2).map((name, i) => (
            <span
              // eslint-disable-next-line react/no-array-index-key -- campaign names aren't guaranteed unique
              key={i}
              className="inline-flex max-w-[120px] items-center gap-1 truncate rounded-lg border border-border px-2 py-0.5 text-xs text-muted-foreground"
            >
              <Megaphone className="h-3 w-3 shrink-0" />
              <span className="truncate">
                <BidiText>{name}</BidiText>
              </span>
            </span>
          ))}
          {influencer.activeCampaignNames.length > 2 ? (
            <span className="text-xs text-muted-foreground">
              +{influencer.activeCampaignNames.length - 2}
            </span>
          ) : null}
        </div>
      ) : null}

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
          <Badge tone="neutral">
            {t.rich('directory.results.totalFollowersBadge', {
              count: formatCompact(influencer.totalFollowers),
              ltr: (chunks) => <LtrText>{chunks}</LtrText>,
            })}
          </Badge>
        ) : null}
      </div>
    </Link>
  );
}
