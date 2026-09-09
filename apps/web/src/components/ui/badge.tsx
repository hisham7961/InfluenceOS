import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { Tone } from '@influenceos/contracts';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-muted text-muted-foreground',
        info: 'border-info/20 bg-info/10 text-info',
        success: 'border-success/20 bg-success/10 text-success',
        warning: 'border-warning/25 bg-warning/10 text-warning',
        danger: 'border-danger/20 bg-danger/10 text-danger',
        accent: 'border-accent/20 bg-accent/10 text-accent',
      },
      solid: { true: 'border-transparent' },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  tone?: Tone;
}

export function Badge({ className, tone = 'neutral', solid, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, solid }), className)} {...props} />;
}
