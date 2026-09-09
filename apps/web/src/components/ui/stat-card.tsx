'use client';

import {
  ArrowDownRight,
  ArrowUpRight,
  Database,
  HardDrive,
  Megaphone,
  PackageCheck,
  PlaySquare,
  Upload,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent } from './card';
import { AnimatedNumber } from './animated-number';
import { cn } from '@/lib/cn';

export type StatCardTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

/**
 * Named icons a Server Component can request by string. Server Components cannot
 * pass a Lucide icon (a function) to this client component — that trips React's
 * "functions cannot be passed to Client Components" boundary — so they pass
 * `iconName` and the mapping happens here, inside the client boundary.
 */
export const STAT_ICONS = {
  megaphone: Megaphone,
  users: Users,
  content: PlaySquare,
  wallet: Wallet,
  deliverables: PackageCheck,
  harddrive: HardDrive,
  database: Database,
  upload: Upload,
} satisfies Record<string, LucideIcon>;

export type StatIconName = keyof typeof STAT_ICONS;

const toneIconStyles: Record<StatCardTone, string> = {
  neutral: 'bg-surface-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
  accent: 'bg-accent/10 text-accent',
};

export interface StatCardTrend {
  /** Signed change, e.g. 12.4 or -3.1. Rendered with an explicit + for non-negative values. */
  value: number;
  /** Trailing context, e.g. "vs last 30 days". */
  label?: string;
}

export interface StatCardProps {
  label: string;
  value: number | null;
  /** Icon component — for CLIENT callers only (a function can't cross the RSC
   *  boundary). Server Components must use `iconName` instead. */
  icon?: LucideIcon;
  /** Icon by name — the Server-Component-safe way to set an icon. */
  iconName?: StatIconName;
  /** Client-side number formatter. Do NOT pass this from a Server Component —
   *  functions can't cross the RSC boundary; use `formatted` instead. */
  format?: (n: number) => string;
  /** Pre-formatted display string. Use this from Server Components (which
   *  cannot pass a `format` function). Takes precedence over `format`/animation. */
  formatted?: string;
  hint?: string;
  tone?: StatCardTone;
  trend?: StatCardTrend;
  className?: string;
}

/** A premium bento-style KPI tile: tone-tinted icon, label, an animated headline number, and an optional trend/hint row. */
export function StatCard({
  label,
  value,
  icon,
  iconName,
  format,
  formatted,
  hint,
  tone = 'neutral',
  trend,
  className,
}: StatCardProps) {
  const Icon = icon ?? (iconName ? STAT_ICONS[iconName] : undefined);
  const isPositiveTrend = trend !== undefined ? trend.value >= 0 : null;
  const TrendIcon = isPositiveTrend ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className={cn('overflow-hidden transition-shadow hover:shadow-pop', className)}>
      <CardContent className="flex flex-col gap-4 p-5 pt-5">
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          {Icon ? (
            <span
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-xl',
                toneIconStyles[tone],
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
            </span>
          ) : null}
        </div>

        <div className="text-3xl font-semibold tracking-tight text-foreground">
          {formatted != null ? formatted : <AnimatedNumber value={value} format={format} />}
        </div>

        {hint || trend ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {trend ? (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 font-medium',
                  isPositiveTrend ? 'text-success' : 'text-danger',
                )}
              >
                <TrendIcon className="size-3.5" aria-hidden="true" />
                {isPositiveTrend ? '+' : ''}
                {trend.value}%
              </span>
            ) : null}
            {trend?.label ? <span className="text-muted-foreground">{trend.label}</span> : null}
            {hint ? <span className="text-muted-foreground">{hint}</span> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
