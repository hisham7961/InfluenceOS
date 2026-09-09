import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus, Users } from 'lucide-react';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { InfluencerCard } from '@/components/influencers/influencer-card';
import { DirectoryFilters } from './directory-filters';

export const dynamic = 'force-dynamic';

type Filters = Record<string, string | undefined>;

/** Builds a query string for the influencer directory, merging current filters with overrides (used for pagination links). */
function buildHref(current: Filters, overrides: Filters): string {
  const params = new URLSearchParams();
  const merged = { ...current, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/influencers?${qs}` : '/influencers';
}

export default async function InfluencersPage({
  searchParams,
}: {
  searchParams: Promise<Filters>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const api = getServerApi();
  const { data: influencers, pagination } = await api.influencers.list({
    q: sp.q || undefined,
    platform: sp.platform || undefined,
    country: sp.country || undefined,
    category: sp.category || undefined,
    relationshipStatus: sp.relationshipStatus || undefined,
    minFollowers: sp.minFollowers ? Number(sp.minFollowers) : undefined,
    maxFollowers: sp.maxFollowers ? Number(sp.maxFollowers) : undefined,
    page,
    pageSize: 24,
  });

  const hasFilters = Boolean(
    sp.q || sp.platform || sp.country || sp.category || sp.relationshipStatus || sp.minFollowers || sp.maxFollowers,
  );

  return (
    <div>
      <PageHeader
        title="Influencers"
        description="Your global creator network."
        actions={
          <Button asChild>
            <Link href="/influencers/new">
              <Plus className="h-4 w-4" /> Add influencer
            </Link>
          </Button>
        }
      />

      <DirectoryFilters q={sp.q} platform={sp.platform} relationshipStatus={sp.relationshipStatus} />

      {influencers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={hasFilters ? 'No influencers match your filters' : 'Build your creator network'}
          description={
            hasFilters
              ? 'Try a different search term or clear your filters to see everyone.'
              : 'Add your first creator to start tracking relationships, campaigns and content.'
          }
          action={
            hasFilters ? (
              <Button variant="outline" asChild>
                <Link href="/influencers">Clear filters</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/influencers/new">
                  <Plus className="h-4 w-4" /> Add influencer
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {influencers.map((influencer) => (
              <InfluencerCard key={influencer.id} influencer={influencer} />
            ))}
          </div>

          {pagination.totalPages > 1 ? (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} influencer
                {pagination.total === 1 ? '' : 's'}
              </p>
              <div className="flex items-center gap-2">
                {page <= 1 ? (
                  <Button variant="outline" size="sm" disabled>
                    <ChevronLeft className="h-4 w-4" /> Previous
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={buildHref(sp, { page: String(page - 1) })}>
                      <ChevronLeft className="h-4 w-4" /> Previous
                    </Link>
                  </Button>
                )}
                {page >= pagination.totalPages ? (
                  <Button variant="outline" size="sm" disabled>
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={buildHref(sp, { page: String(page + 1) })}>
                      Next <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
