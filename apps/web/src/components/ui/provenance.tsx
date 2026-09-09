'use client';

import * as React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { DATA_SOURCE_LABELS } from '@influenceos/shared';
import type { ProvenanceDTO } from '@influenceos/contracts';
import { cn } from '@/lib/cn';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

export interface ProvenanceTooltipProps {
  /** Where the value came from and when it was last refreshed. */
  provenance: ProvenanceDTO;
  /** Element the tooltip is anchored to. */
  children: React.ReactNode;
}

/** Wraps `children` in a tooltip explaining where a value came from and when it was last updated. */
export function ProvenanceTooltip({ provenance, children }: ProvenanceTooltipProps) {
  const { source, updatedAt, updatedByName } = provenance;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>
          <div className="flex flex-col gap-0.5">
            <span>Source: {DATA_SOURCE_LABELS[source]}</span>
            {updatedAt ? (
              <span>
                Updated {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
                {updatedByName ? ` by ${updatedByName}` : ''}
              </span>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export interface DataSourceBadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  source: ProvenanceDTO['source'];
}

/** A tiny muted pill labelling where a value's data came from. */
export function DataSourceBadge({ source, className, ...props }: DataSourceBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground',
        className,
      )}
      {...props}
    >
      {DATA_SOURCE_LABELS[source]}
    </span>
  );
}
