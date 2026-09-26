import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';

function pageWindow(current: number, total: number): (number | 'ellipsis')[] {
  const delta = 1;
  const left = Math.max(2, current - delta);
  const right = Math.min(total - 1, current + delta);
  const pages: (number | 'ellipsis')[] = [1];
  if (left > 2) pages.push('ellipsis');
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push('ellipsis');
  if (total > 1) pages.push(total);
  return pages;
}

type PaginationBaseProps = {
  page: number;
  totalPages: number;
  previousLabel: string;
  nextLabel: string;
  pageAriaLabel: (page: number) => string;
};

/** Server-page mode: plain <Link>s built from a page number, so it renders
 *  fine from an async Server Component with no client JS. */
type PaginationLinkProps = PaginationBaseProps & { buildHref: (page: number) => string; onPageChange?: never };

/** Client-widget mode: a button per page that calls back with the page
 *  number, for a self-fetching client component (e.g. a `useQuery`-backed
 *  tab) where the page isn't part of the URL. */
type PaginationButtonProps = PaginationBaseProps & { onPageChange: (page: number) => void; buildHref?: never };

/**
 * Numbered page navigation for offset-paginated lists (a real
 * `total`/`totalPages`, not a cursor feed). Pass `buildHref` for a
 * server-rendered page, or `onPageChange` for a client-fetched widget.
 */
export function Pagination(props: PaginationLinkProps | PaginationButtonProps) {
  const { page, totalPages, previousLabel, nextLabel, pageAriaLabel } = props;
  if (totalPages <= 1) return null;
  const pages = pageWindow(page, totalPages);

  function PageButton({ target, children, ariaLabel }: { target: number; children: React.ReactNode; ariaLabel: string }) {
    if (props.buildHref) {
      return (
        <Button variant="outline" size="icon-sm" asChild>
          <Link href={props.buildHref(target)} aria-label={ariaLabel}>
            {children}
          </Link>
        </Button>
      );
    }
    return (
      <Button variant="outline" size="icon-sm" onClick={() => props.onPageChange(target)} aria-label={ariaLabel}>
        {children}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {page <= 1 ? (
        <Button variant="outline" size="icon-sm" disabled aria-label={previousLabel}>
          <ChevronLeft className="rtl:-scale-x-100 h-4 w-4" />
        </Button>
      ) : (
        <PageButton target={page - 1} ariaLabel={previousLabel}>
          <ChevronLeft className="rtl:-scale-x-100 h-4 w-4" />
        </PageButton>
      )}

      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span key={`ellipsis-${i}`} className="px-1 text-sm text-muted-foreground">
            …
          </span>
        ) : p === page ? (
          <Button key={p} variant="secondary" size="icon-sm" disabled aria-current="page" aria-label={pageAriaLabel(p)}>
            {p}
          </Button>
        ) : (
          <PageButton key={p} target={p} ariaLabel={pageAriaLabel(p)}>
            {p}
          </PageButton>
        ),
      )}

      {page >= totalPages ? (
        <Button variant="outline" size="icon-sm" disabled aria-label={nextLabel}>
          <ChevronRight className="rtl:-scale-x-100 h-4 w-4" />
        </Button>
      ) : (
        <PageButton target={page + 1} ariaLabel={nextLabel}>
          <ChevronRight className="rtl:-scale-x-100 h-4 w-4" />
        </PageButton>
      )}
    </div>
  );
}
