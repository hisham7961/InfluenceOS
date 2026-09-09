import Link from 'next/link';
import { ChevronLeft, ChevronRight, Megaphone, Plus } from 'lucide-react';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { CampaignCard } from '@/components/campaigns/campaign-card';
import { CampaignFilters } from './campaign-filters';

export const dynamic = 'force-dynamic';

type Filters = Record<string, string | undefined>;

/** Builds a query string for the campaigns list, merging current filters with overrides (used for pagination links). */
function buildHref(current: Filters, overrides: Filters): string {
  const params = new URLSearchParams();
  const merged = { ...current, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/campaigns?${qs}` : '/campaigns';
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const api = getServerApi();
  const [{ data: campaigns, pagination }, brands] = await Promise.all([
    api.campaigns.list({
      q: sp.q || undefined,
      brandId: sp.brandId || undefined,
      status: sp.status || undefined,
      page,
      pageSize: 24,
    }),
    api.brands.list(),
  ]);

  const hasFilters = Boolean(sp.q || sp.brandId || sp.status);

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Every campaign across your brands, in one place."
        actions={
          <Button asChild>
            <Link href="/campaigns/new">
              <Plus className="h-4 w-4" /> New campaign
            </Link>
          </Button>
        }
      />

      <CampaignFilters brands={brands} brandId={sp.brandId} status={sp.status} q={sp.q} />

      {campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={hasFilters ? 'No campaigns match your filters' : 'Nothing live right now.'}
          description={
            hasFilters
              ? 'Try a different search term or clear your filters to see everything.'
              : 'Launch your first campaign to start tracking influencers, deliverables and spend.'
          }
          action={
            hasFilters ? (
              <Button variant="outline" asChild>
                <Link href="/campaigns">Clear filters</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/campaigns/new">
                  <Plus className="h-4 w-4" /> New campaign
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {campaigns.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </div>

          {pagination.totalPages > 1 ? (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} campaign
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
