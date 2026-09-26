import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Megaphone, Plus } from 'lucide-react';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
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
  const t = await getTranslations('campaigns');
  const tCommon = await getTranslations('common');

  const api = getServerApi();
  const [{ data: campaigns, pagination }, brands] = await Promise.all([
    api.campaigns.list({
      q: sp.q || undefined,
      brandId: sp.brandId || undefined,
      status: sp.status || undefined,
      // Deep-link only (Data Quality Center / Needs Attention "campaigns
      // missing an owner"), not a UI filter chip — same pattern as
      // logistics-workspace.tsx's hasOpenIssue.
      ownerMissing: sp.ownerMissing || undefined,
      ownerId: sp.ownerId || undefined,
      objective: sp.objective || undefined,
      sort: sp.sort || undefined,
      order: sp.order === 'asc' ? 'asc' : sp.order === 'desc' ? 'desc' : undefined,
      page,
      pageSize: 24,
    }),
    api.brands.list(),
  ]);

  const hasFilters = Boolean(sp.q || sp.brandId || sp.status || sp.objective || sp.ownerId || sp.ownerMissing);

  return (
    <div>
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        actions={
          <Button asChild>
            <Link href="/campaigns/new">
              <Plus className="h-4 w-4" /> {t('list.newCampaign')}
            </Link>
          </Button>
        }
      />

      <CampaignFilters brands={brands} brandId={sp.brandId} status={sp.status} q={sp.q} />

      {campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={hasFilters ? t('list.emptyFilteredTitle') : t('list.emptyTitle')}
          description={hasFilters ? t('list.emptyFilteredDescription') : t('list.emptyDescription')}
          action={
            hasFilters ? (
              <Button variant="outline" asChild>
                <Link href="/campaigns">{tCommon('clearFilters')}</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/campaigns/new">
                  <Plus className="h-4 w-4" /> {t('list.newCampaign')}
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
                {t('list.paginationSummary', {
                  page: pagination.page,
                  totalPages: pagination.totalPages,
                  count: pagination.total,
                })}
              </p>
              <Pagination
                page={page}
                totalPages={pagination.totalPages}
                buildHref={(p) => buildHref(sp, { page: String(p) })}
                previousLabel={tCommon('previous')}
                nextLabel={tCommon('next')}
                pageAriaLabel={(p) => t('list.goToPage', { page: p })}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
