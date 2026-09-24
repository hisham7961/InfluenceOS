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

/**
 * Numbered page navigation for offset-paginated management tables (a real
 * `total`/`totalPages`, not a cursor feed). Plain <Link>s, no client state,
 * so it renders fine from an async Server Component page.
 */
export function Pagination({
  page,
  totalPages,
  buildHref,
  previousLabel,
  nextLabel,
  pageAriaLabel,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
  previousLabel: string;
  nextLabel: string;
  pageAriaLabel: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  const pages = pageWindow(page, totalPages);

  return (
    <div className="flex items-center gap-1.5">
      {page <= 1 ? (
        <Button variant="outline" size="icon-sm" disabled aria-label={previousLabel}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
      ) : (
        <Button variant="outline" size="icon-sm" asChild>
          <Link href={buildHref(page - 1)} aria-label={previousLabel}>
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
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
          <Button key={p} variant="outline" size="icon-sm" asChild>
            <Link href={buildHref(p)} aria-label={pageAriaLabel(p)}>
              {p}
            </Link>
          </Button>
        ),
      )}

      {page >= totalPages ? (
        <Button variant="outline" size="icon-sm" disabled aria-label={nextLabel}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      ) : (
        <Button variant="outline" size="icon-sm" asChild>
          <Link href={buildHref(page + 1)} aria-label={nextLabel}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      )}
    </div>
  );
}
