import Link from 'next/link';
import { Building2, Plus } from 'lucide-react';
import type { BrandSummaryDTO } from '@influenceos/contracts';
import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';

export const dynamic = 'force-dynamic';

export default async function BrandsPage() {
  const api = getServerApi();
  const [user, brands] = await Promise.all([
    api.auth.me(),
    api.brands.list({ includeInactive: true }),
  ]);
  const isAdmin = user.role === 'ADMIN';

  return (
    <div>
      <PageHeader
        title="Brands"
        description="Every brand workspace you manage, in one place."
        actions={
          isAdmin ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-surface-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <Plus className="h-3.5 w-3.5" /> Add brand — managed in platform settings
            </span>
          ) : null
        }
      />

      {brands.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No brands yet"
          description="Brand workspaces will appear here once they're set up."
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {brands.map((brand) => (
            <BrandCard key={brand.id} brand={brand} />
          ))}
        </div>
      )}
    </div>
  );
}

function BrandCard({ brand }: { brand: BrandSummaryDTO }) {
  return (
    <Link
      href={`/brands/${brand.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop"
    >
      <div
        className="relative flex h-28 items-end overflow-hidden p-4"
        style={{
          background: `linear-gradient(135deg, ${brand.primaryColor}, ${brand.accentColor ?? brand.primaryColor})`,
        }}
      >
        <div className="absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/15" />
        <div className="absolute right-10 top-5 h-10 w-10 rounded-full bg-white/10" />
        <div
          className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-lg font-bold shadow-soft"
          style={{ color: brand.primaryColor }}
        >
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} className="h-full w-full object-cover" />
          ) : (
            brand.name.charAt(0).toUpperCase()
          )}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate font-semibold transition-colors group-hover:text-brand">{brand.name}</p>
          <p className="truncate text-xs text-muted-foreground">/{brand.slug}</p>
        </div>
        <Badge tone={brand.isActive ? 'success' : 'neutral'}>{brand.isActive ? 'Active' : 'Inactive'}</Badge>
      </div>
    </Link>
  );
}
