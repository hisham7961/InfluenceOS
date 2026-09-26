'use client';

import { useTranslations } from 'next-intl';
import type { OffsetPagination } from '@influenceos/contracts';
import { cn } from '@/lib/cn';
import { Pagination } from './pagination';

/**
 * "Showing 21–40 of 312" and numbered pages under a list. Always says how
 * many there are, so a list is never silently cut short.
 */
export function PageFooter({
  pagination,
  onPageChange,
  className,
}: {
  pagination: OffsetPagination | null | undefined;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const tc = useTranslations('common');
  if (!pagination || pagination.total === 0) return null;
  const from = (pagination.page - 1) * pagination.pageSize + 1;
  const to = Math.min(pagination.page * pagination.pageSize, pagination.total);
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 pt-4', className)}>
      <p className="text-sm text-muted-foreground">{tc('showingRange', { from, to, total: pagination.total })}</p>
      <Pagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        onPageChange={onPageChange}
        previousLabel={tc('previous')}
        nextLabel={tc('next')}
        pageAriaLabel={(p) => tc('goToPage', { page: p })}
      />
    </div>
  );
}
