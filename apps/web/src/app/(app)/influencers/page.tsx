import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Plus, Users } from 'lucide-react';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { DirectoryResults } from '@/components/influencers/directory-results';
import { DirectoryFilters } from './directory-filters';
import { ExportInfluencersButton } from './export-button';

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

  const t = await getTranslations('influencers');
  const tc = await getTranslations('common');
  const api = getServerApi();
  const { data: influencers, pagination } = await api.influencers.list({
    q: sp.q || undefined,
    platform: sp.platform || undefined,
    country: sp.country || undefined,
    countryCode: sp.countryCode || undefined,
    city: sp.city || undefined,
    category: sp.category || undefined,
    relationshipStatus: sp.relationshipStatus || undefined,
    minFollowers: sp.minFollowers ? Number(sp.minFollowers) : undefined,
    maxFollowers: sp.maxFollowers ? Number(sp.maxFollowers) : undefined,
    ownerId: sp.ownerId || undefined,
    sort: sp.sort || undefined,
    order: sp.order === 'asc' ? 'asc' : sp.order === 'desc' ? 'desc' : undefined,
    // Data Quality Center deep-links (e.g. /influencers?missingCountry=true)
    // — not UI filter chips, just real server-side filters a finding row
    // links straight into.
    missingCountry: sp.missingCountry === 'true' ? true : undefined,
    missingOwner: sp.missingOwner === 'true' ? true : undefined,
    missingPhone: sp.missingPhone === 'true' ? true : undefined,
    missingSocial: sp.missingSocial === 'true' ? true : undefined,
    // Smarter creator selection (P3.7).
    audienceCountry: sp.audienceCountry || undefined,
    audienceMinPct: sp.audienceCountry && sp.audienceMinPct ? Number(sp.audienceMinPct) : undefined,
    minEngagementRate: sp.minEngagementRate ? Number(sp.minEngagementRate) : undefined,
    language: sp.language || undefined,
    gender: sp.gender || undefined,
    minRate: sp.minRate ? Number(sp.minRate) : undefined,
    maxRate: sp.maxRate ? Number(sp.maxRate) : undefined,
    rateCurrency: sp.minRate || sp.maxRate ? sp.rateCurrency || undefined : undefined,
    page,
    pageSize: 24,
  });

  const hasFilters = Boolean(
    sp.q ||
      sp.platform ||
      sp.country ||
      sp.countryCode ||
      sp.city ||
      sp.category ||
      sp.relationshipStatus ||
      sp.minFollowers ||
      sp.maxFollowers ||
      sp.ownerId ||
      sp.missingCountry ||
      sp.missingOwner ||
      sp.missingPhone ||
      sp.missingSocial ||
      sp.audienceCountry ||
      sp.minEngagementRate ||
      sp.language ||
      sp.gender ||
      sp.minRate ||
      sp.maxRate,
  );

  return (
    <div>
      <PageHeader
        title={t('directory.pageTitle')}
        description={t('directory.pageDescription')}
        actions={
          <div className="flex items-center gap-2">
            <ExportInfluencersButton
              // Exactly the filters the list uses (country code, city and the
              // Data Quality deep-links included), so the file matches the screen.
              filters={{
                q: sp.q,
                platform: sp.platform,
                country: sp.country,
                countryCode: sp.countryCode,
                city: sp.city,
                category: sp.category,
                relationshipStatus: sp.relationshipStatus,
                minFollowers: sp.minFollowers,
                maxFollowers: sp.maxFollowers,
                ownerId: sp.ownerId,
                sort: sp.sort,
                order: sp.order,
                missingCountry: sp.missingCountry === 'true' ? 'true' : undefined,
                missingOwner: sp.missingOwner === 'true' ? 'true' : undefined,
                missingPhone: sp.missingPhone === 'true' ? 'true' : undefined,
                missingSocial: sp.missingSocial === 'true' ? 'true' : undefined,
              }}
            />
            <Button asChild>
              <Link href="/influencers/new">
                <Plus className="h-4 w-4" /> {t('directory.addInfluencer')}
              </Link>
            </Button>
          </div>
        }
      />

      <DirectoryFilters q={sp.q} platform={sp.platform} relationshipStatus={sp.relationshipStatus} countryCode={sp.countryCode} city={sp.city} />

      {influencers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={hasFilters ? t('directory.empty.filteredTitle') : t('directory.empty.emptyTitle')}
          description={
            hasFilters ? t('directory.empty.filteredDescription') : t('directory.empty.emptyDescription')
          }
          action={
            hasFilters ? (
              <Button variant="outline" asChild>
                <Link href="/influencers">{tc('clearFilters')}</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/influencers/new">
                  <Plus className="h-4 w-4" /> {t('directory.addInfluencer')}
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <DirectoryResults influencers={influencers} />

          {pagination.totalPages > 1 ? (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
              <p className="text-sm text-muted-foreground">
                {t('directory.pagination.summary', {
                  page: pagination.page,
                  totalPages: pagination.totalPages,
                  count: pagination.total,
                })}
              </p>
              <Pagination
                page={page}
                totalPages={pagination.totalPages}
                buildHref={(p) => buildHref(sp, { page: String(p) })}
                previousLabel={tc('previous')}
                nextLabel={tc('next')}
                pageAriaLabel={(p) => t('directory.pagination.goToPage', { page: p })}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
