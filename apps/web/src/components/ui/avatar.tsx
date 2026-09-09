'use client';
import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { colorFromString, initials } from '@influenceos/shared';
import { cn } from '@/lib/cn';

const sizeMap = { xs: 'h-6 w-6 text-[10px]', sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-base', xl: 'h-20 w-20 text-xl', '2xl': 'h-28 w-28 text-3xl' } as const;

export interface AvatarProps {
  src?: string | null;
  name: string;
  size?: keyof typeof sizeMap;
  className?: string;
  rounded?: 'full' | 'lg';
}

export function Avatar({ src, name, size = 'md', className, rounded = 'full' }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative flex shrink-0 overflow-hidden ring-1 ring-border',
        rounded === 'full' ? 'rounded-full' : 'rounded-xl',
        sizeMap[size],
        className,
      )}
    >
      {src ? (
        <AvatarPrimitive.Image src={src} alt={name} className="aspect-square h-full w-full object-cover" />
      ) : null}
      <AvatarPrimitive.Fallback
        className="flex h-full w-full items-center justify-center font-semibold text-white"
        style={{ backgroundColor: colorFromString(name) }}
        delayMs={src ? 300 : 0}
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
