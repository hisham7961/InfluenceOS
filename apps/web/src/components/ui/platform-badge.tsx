import * as React from 'react';
import { Instagram, Youtube, Twitter, Music2, Ghost, type LucideIcon } from 'lucide-react';
import { PLATFORM_META, type Platform } from '@influenceos/shared';
import { cn } from '@/lib/cn';

const PLATFORM_ICONS: Record<Platform, LucideIcon> = {
  INSTAGRAM: Instagram,
  YOUTUBE: Youtube,
  X: Twitter,
  TIKTOK: Music2,
  SNAPCHAT: Ghost,
};

export interface PlatformIconProps extends Omit<React.SVGAttributes<SVGSVGElement>, 'color'> {
  platform: Platform;
  className?: string;
}

/** Renders the lucide icon that represents a platform. */
export function PlatformIcon({ platform, className, ...props }: PlatformIconProps) {
  const Icon = PLATFORM_ICONS[platform];
  return <Icon aria-hidden="true" className={cn('size-4', className)} {...props} />;
}

const sizeStyles = {
  sm: { pill: 'h-6 gap-1 px-1.5 text-xs', icon: 'size-3', iconOnly: 'w-6 px-0 justify-center' },
  md: { pill: 'h-8 gap-1.5 px-2 text-sm', icon: 'size-4', iconOnly: 'w-8 px-0 justify-center' },
} as const;

export interface PlatformBadgeProps {
  platform: Platform;
  size?: keyof typeof sizeStyles;
  withLabel?: boolean;
  className?: string;
}

/** A small pill showing a platform's icon (tinted to its brand color) and optional label. */
export function PlatformBadge({ platform, size = 'md', withLabel = true, className }: PlatformBadgeProps) {
  const meta = PLATFORM_META[platform];
  const styles = sizeStyles[size];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-surface-muted font-medium text-foreground',
        styles.pill,
        !withLabel && styles.iconOnly,
        className,
      )}
      title={meta.label}
    >
      <PlatformIcon platform={platform} className={styles.icon} style={{ color: meta.color }} />
      {withLabel ? <span>{meta.label}</span> : null}
    </span>
  );
}
