import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * One table primitive (W5-2 / UX-02) — consistent density, borders and hover,
 * built with logical alignment (text-start / text-end) so it mirrors correctly
 * in RTL. Compose with the sub-components below; wrap in <TableScroll> for the
 * horizontal-scroll container.
 */
export function TableScroll({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('w-full overflow-x-auto', className)} {...props} />;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-sm', className)} {...props} />;
}

export function TableHead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={className} {...props} />;
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function TableFooter({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tfoot className={className} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn('border-b border-border/60 transition-colors last:border-0 hover:bg-surface-muted/40', className)}
      {...props}
    />
  );
}

const alignClass = (align?: 'start' | 'end' | 'center') =>
  align === 'end' ? 'text-end tabular-nums' : align === 'center' ? 'text-center' : 'text-start';

export function TableHeaderCell({
  className,
  align,
  ...props
}: Omit<React.ThHTMLAttributes<HTMLTableCellElement>, 'align'> & { align?: 'start' | 'end' | 'center' }) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
        alignClass(align),
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  align,
  ...props
}: Omit<React.TdHTMLAttributes<HTMLTableCellElement>, 'align'> & { align?: 'start' | 'end' | 'center' }) {
  return <td className={cn('whitespace-nowrap px-4 py-3 text-foreground', alignClass(align), className)} {...props} />;
}
