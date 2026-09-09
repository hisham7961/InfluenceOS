'use client';
import * as React from 'react';
import { ExternalLink, PlayCircle } from 'lucide-react';
import { isAllowedIframeOrigin, type EmbedDescriptor } from '@influenceos/shared';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { ContentStatusBadge } from '@/components/ui/status-badges';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

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
  content: PublishedContentDTO;
  autoPlay?: boolean;
  className?: string;
}) {
  const [playing, setPlaying] = React.useState(autoPlay);
  const embed = content.embed;
  const canEmbed = !!embed && embed.kind === 'iframe' && !!embed.iframeSrc && isAllowedIframeOrigin(embed.iframeSrc);
  const aspect = embed?.aspectRatio ?? 16 / 9;

  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-xl bg-black', className)}
      style={{ aspectRatio: aspect }}
    >
      {canEmbed && playing ? (
        <iframe
          src={embed!.iframeSrc}
          title={content.caption ?? 'Embedded content'}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
        />
      ) : (
        <Fallback content={content} canEmbed={canEmbed} onPlay={() => setPlaying(true)} />
      )}
    </div>
  );
}

function Fallback({
  content,
  canEmbed,
  onPlay,
}: {
  content: PublishedContentDTO;
  canEmbed: boolean;
  onPlay: () => void;
}) {
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
      <div className="absolute left-3 top-3 flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-xs backdrop-blur">
          <PlatformIcon platform={content.platform} className="h-3.5 w-3.5" />
        </span>
        <span className="rounded-full bg-black/50 px-2 py-1 text-[11px] backdrop-blur">
          <ContentStatusBadge status={content.availabilityStatus} />
        </span>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-2 text-center">
        {canEmbed ? (
          <button onClick={onPlay} className="group flex flex-col items-center gap-2" aria-label="Play">
            <PlayCircle className="h-16 w-16 drop-shadow transition-transform group-hover:scale-110" />
            <span className="text-sm font-medium">Play {content.platform.toLowerCase()} content</span>
          </button>
        ) : (
          <div className="flex flex-col items-center gap-2 px-6">
            <PlayCircle className="h-12 w-12 opacity-60" />
            <p className="text-sm font-medium">Preview not available for this platform</p>
            <Button asChild variant="secondary" size="sm">
              <a href={content.originalUrl} target="_blank" rel="noopener noreferrer">
                Open original <ExternalLink className="h-3.5 w-3.5" />
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
