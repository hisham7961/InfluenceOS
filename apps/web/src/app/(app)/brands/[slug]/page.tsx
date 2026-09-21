import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import type { BrandDashboardDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { getServerApi } from '@/lib/api-server';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { SectionHeader } from '@/components/common/page-header';
import { MissionControl } from '@/components/dashboard/mission-control';
import { ContentGrid } from '@/components/content/content-grid';
import { BidiText } from '@/components/common/bidi-text';
import { formatCurrency } from '@/lib/format';
import { BrandEditDialog } from './brand-edit-dialog';
import { BrandNotesCard } from './brand-notes-card';
import { UsageRightsCard } from './usage-rights-card';

export const dynamic = 'force-dynamic';

export default async function BrandWorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const api = getServerApi();
  const t = await getTranslations('brands');

  let dashboard: BrandDashboardDTO;
  try {
    dashboard = await api.brands.dashboard(slug);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const { brand } = dashboard;
  const stats = brand.stats;
  // Usage-rights ledger (W3-2) — surfaced read-only; a failure here must not
  // take down the whole brand workspace.
  const usageRights = await api.brands.usageRights(brand.id).catch(() => []);
  // Brand content (Content Command Center pass, item 19) — the SAME
  // PublishedContent feed and ContentCard/ContentViewer every other content
  // surface uses, just brandId-scoped; no second content model.
  const brandContent = await api.content.feed({ brandId: brand.id, limit: 24 }).catch(() => ({ data: [], hasMore: false, nextCursor: null }));

  return (
    <div>
      <Link
        href="/brands"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {t('detail.backToBrands')}
      </Link>

      {/* Brand hero */}
      <Card className="mb-6 overflow-hidden">
        <div
          className="relative flex items-end overflow-hidden p-6 sm:p-8"
          style={{
            background: `linear-gradient(135deg, ${brand.primaryColor}, ${brand.secondaryColor ?? brand.accentColor ?? brand.primaryColor})`,
          }}
        >
          {brand.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.coverUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-30"
            />
          ) : (
            <>
              <div className="absolute -right-10 -top-14 h-48 w-48 rounded-full bg-white/10" />
              <div className="absolute right-24 top-8 h-20 w-20 rounded-full bg-white/10" />
            </>
          )}

          <div className="relative flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-2xl font-bold shadow-soft"
                style={{ color: brand.primaryColor }}
              >
                {brand.logoUrl ?? brand.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={brand.logoUrl ?? brand.iconUrl ?? undefined}
                    alt={brand.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  brand.name.charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <BidiText as="h1" className="text-2xl font-bold tracking-tight text-white drop-shadow-sm">
                    {brand.name}
                  </BidiText>
                  <Badge tone={brand.isActive ? 'success' : 'neutral'} className="border-white/30 bg-white/15 text-white">
                    {brand.isActive ? t('status.active') : t('status.inactive')}
                  </Badge>
                </div>
                {brand.description ? (
                  <p className="max-w-2xl text-sm text-white/85">{brand.description}</p>
                ) : null}
              </div>
            </div>

            <BrandEditDialog brand={brand} />
          </div>
        </div>
      </Card>

      {/* Stat tiles — iconName (not icon) because Server Components can't pass
          a Lucide icon function across the RSC boundary. */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={t('detail.stats.activeCampaigns')}
          value={stats.activeCampaigns}
          iconName="megaphone"
          tone="info"
          hint={t('detail.stats.totalCampaignsHint', { count: stats.totalCampaigns })}
        />
        <StatCard label={t('detail.stats.influencers')} value={stats.influencers} iconName="users" tone="accent" />
        <StatCard label={t('detail.stats.contentPublished')} value={stats.contentCount} iconName="content" tone="success" />
        <StatCard
          label={t('detail.stats.totalSpend')}
          value={stats.totalSpend}
          iconName="wallet"
          tone="warning"
          formatted={formatCurrency(stats.totalSpend, stats.currency)}
        />
      </div>

      {/* Brand-scoped Mission Control */}
      <MissionControl data={dashboard} brandId={brand.id} />

      <section className="mt-8">
        <SectionHeader
          title={t('detail.content')}
          action={
            <Link href={`/content`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              {t('detail.viewInLiveContent')}
            </Link>
          }
        />
        <ContentGrid
          items={brandContent.data}
          emptyTitle={t('detail.noContentTitle')}
          emptyDescription={t('detail.noContentDescription', { name: brand.name })}
        />
      </section>

      <UsageRightsCard rights={usageRights} />
      <BrandNotesCard brandId={brand.id} />
    </div>
  );
}
