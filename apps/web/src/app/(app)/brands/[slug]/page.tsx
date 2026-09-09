import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { BrandDashboardDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { getServerApi } from '@/lib/api-server';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { MissionControl } from '@/components/dashboard/mission-control';
import { formatCurrency } from '@/lib/format';
import { BrandEditDialog } from './brand-edit-dialog';

export const dynamic = 'force-dynamic';

export default async function BrandWorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const api = getServerApi();

  let dashboard: BrandDashboardDTO;
  try {
    dashboard = await api.brands.dashboard(slug);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const { brand } = dashboard;
  const stats = brand.stats;

  return (
    <div>
      <Link
        href="/brands"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Brands
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
                  <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-sm">{brand.name}</h1>
                  <Badge tone={brand.isActive ? 'success' : 'neutral'} className="border-white/30 bg-white/15 text-white">
                    {brand.isActive ? 'Active' : 'Inactive'}
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
        <StatCard label="Active Campaigns" value={stats.activeCampaigns} iconName="megaphone" tone="info" hint={`${stats.totalCampaigns} total`} />
        <StatCard label="Influencers" value={stats.influencers} iconName="users" tone="accent" />
        <StatCard label="Content Published" value={stats.contentCount} iconName="content" tone="success" />
        <StatCard
          label="Total Spend"
          value={stats.totalSpend}
          iconName="wallet"
          tone="warning"
          formatted={formatCurrency(stats.totalSpend, stats.currency)}
        />
      </div>

      {/* Brand-scoped Mission Control */}
      <MissionControl data={dashboard} />
    </div>
  );
}
