'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, PlayCircle } from 'lucide-react';
import { isAllowedIframeOrigin, type EmbedDescriptor, type Platform } from '@influenceos/shared';
import type { ContentStatus } from '@influenceos/contracts';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { ContentStatusBadge } from '@/components/ui/status-badges';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { toBrowserUrl } from '@/lib/upload';

/**
 * The fields SocialContentPlayer actually reads — a strict subset of
 * PublishedContentDTO, so it plays PublishedContentDTO as-is and also plays
 * anything else with the same shape (e.g. an InspirationItemDTO, mapped to
 * this shape by its own card/detail view) without a parallel player. platform
 * may be null (a trend link whose platform couldn't be detected) — canEmbed
 * is false in that case, so the fallback never needs it. availabilityStatus
 * is omitted entirely for content with no monitoring concept (trend links).
 */
export interface SocialPlayableContent {
  platform: Platform | null;
  embed: EmbedDescriptor | null;
  thumbnailUrl: string | null;
  caption: string | null;
  originalUrl: string;
  availabilityStatus?: ContentStatus;
  /** A Story's own screenshot/recording — when set, the player renders this
   *  native <img>/<video> directly instead of any iframe embed (a Story's
   *  `embed` is always null; see mappers.ts's toPublishedContentDTO). */
  storyMedia?: { url: string; kind: 'image' | 'video'; mimeType: string } | null;
}

/**
 * Reusable social content player (spec §17). Renders the official, allowlisted
 * embed for a piece of content, or a graceful fallback (thumbnail + metadata +
 * "Open Original") when embedding is unavailable. It NEVER renders arbitrary
 * provider HTML — only a strictly-typed, origin-checked iframe. To keep the
 * feed fast, the iframe is only mounted after the user presses play.
 */
export function SocialContentPlayer({
  content,
  autoPlay = false,
  className,
}: {
  content: SocialPlayableContent;
  autoPlay?: boolean;
  className?: string;
}) {
  const t = useTranslations('content');
  const [playing, setPlaying] = React.useState(autoPlay);
  const embed = content.embed;
  const canEmbed = !!embed && embed.kind === 'iframe' && !!embed.iframeSrc && isAllowedIframeOrigin(embed.iframeSrc);
  const aspect = content.storyMedia ? 9 / 16 : (embed?.aspectRatio ?? 16 / 9);
  // embed.platform is always set whenever embed.kind === 'iframe' (buildEmbed
  // never produces one without a resolved platform) — prefer it over
  // content.platform so the play-button copy is correct even when the
  // content's own platform field is null but its embed still resolved one.
  const platform = embed?.platform ?? content.platform;

  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-xl bg-black', className)}
      style={{ aspectRatio: aspect }}
    >
      {content.storyMedia ? (
        <StoryMedia media={content.storyMedia} caption={content.caption} />
      ) : canEmbed && playing ? (
        <iframe
          src={embed!.iframeSrc}
          title={content.caption ?? t('player.embeddedContentTitle')}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
        />
      ) : (
        <Fallback content={content} platform={platform} canEmbed={canEmbed} onPlay={() => setPlaying(true)} />
      )}
    </div>
  );
}

/** A Story's own media, played natively — never through the iframe/embed
 *  path above, since there's no provider to embed from (see storyMedia doc
 *  on SocialPlayableContent). */
function StoryMedia({
  media,
  caption,
}: {
  media: NonNullable<SocialPlayableContent['storyMedia']>;
  caption: string | null;
}) {
  const src = toBrowserUrl(media.url);
  return media.kind === 'video' ? (
    <video
      src={src}
      controls
      playsInline
      className="absolute inset-0 h-full w-full object-contain"
    />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={caption ?? ''} className="absolute inset-0 h-full w-full object-contain" />
  );
}

function Fallback({
  content,
  platform,
  canEmbed,
  onPlay,
}: {
  content: SocialPlayableContent;
  platform: Platform | null;
  canEmbed: boolean;
  onPlay: () => void;
}) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-neutral-900 to-neutral-800 text-white">
      {content.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={content.thumbnailUrl}
          alt={content.caption ?? ''}
          className="absolute inset-0 h-full w-full object-cover opacity-70"
        />
      ) : null}
      <div className="absolute start-3 top-3 flex items-center gap-2">
        {platform ? (
          <span className="flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-xs backdrop-blur">
            <PlatformIcon platform={platform} className="h-3.5 w-3.5" />
          </span>
        ) : null}
        {content.availabilityStatus ? (
          <span className="rounded-full bg-black/50 px-2 py-1 text-[11px] backdrop-blur">
            <ContentStatusBadge status={content.availabilityStatus} />
          </span>
        ) : null}
      </div>

      <div className="relative z-10 flex flex-col items-center gap-2 text-center">
        {canEmbed && platform ? (
          <button onClick={onPlay} className="group flex flex-col items-center gap-2" aria-label={t('player.play')}>
            <PlayCircle className="h-16 w-16 drop-shadow transition-transform group-hover:scale-110" />
            <span className="text-sm font-medium">
              {t('player.playPlatformContent', { platform: platform.toLowerCase() })}
            </span>
          </button>
        ) : (
          <div className="flex flex-col items-center gap-2 px-6">
            <PlayCircle className="h-12 w-12 opacity-60" />
            <p className="text-sm font-medium">{t('player.previewUnavailable')}</p>
            <Button asChild variant="secondary" size="sm">
              <a href={content.originalUrl} target="_blank" rel="noopener noreferrer">
                {tCommon('openOriginal')} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function isEmbeddable(embed: EmbedDescriptor | null): boolean {
  return !!embed && embed.kind === 'iframe' && !!embed.iframeSrc && isAllowedIframeOrigin(embed.iframeSrc);
}
