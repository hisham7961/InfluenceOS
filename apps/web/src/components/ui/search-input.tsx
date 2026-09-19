import * as React from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Input } from './input';

/**
 * Shared search field (W5-1 / UX-08). One consistent look for every directory /
 * filter search, built with logical properties (`start`, `ps`) so the leading
 * magnifier sits correctly in both LTR and RTL (Arabic) layouts.
 */
export const SearchInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full">
      <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input ref={ref} type="search" className={cn('ps-9', className)} {...props} />
    </div>
  ),
);
SearchInput.displayName = 'SearchInput';
