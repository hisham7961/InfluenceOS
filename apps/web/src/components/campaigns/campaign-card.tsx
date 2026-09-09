import Link from 'next/link';
import { CalendarClock, Users } from 'lucide-react';
import type { CampaignSummaryDTO } from '@influenceos/contracts';
import { CampaignStatusBadge } from '@/components/ui/status-badges';
import { ProgressBar } from '@/components/ui/progress';
import { formatCurrency } from '@/lib/format';

export function CampaignCover({
  name,
  coverUrl,
  primaryColor,
  accentColor,
  className = 'h-28',
}: {
  name: string;
  coverUrl?: string | null;
  primaryColor: string;
  accentColor?: string | null;
  className?: string;
}) {
  if (coverUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={coverUrl} alt={name} className={`w-full object-cover ${className}`} />;
  }
  // Beautiful generated fallback from brand colors + campaign name (spec §58).
  return (
    <div
      className={`relative flex w-full items-end overflow-hidden p-4 ${className}`}
      style={{ background: `linear-gradient(135deg, ${primaryColor}, ${accentColor ?? primaryColor})` }}
    >
      <div className="absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/15" />
      <div className="absolute right-8 top-6 h-12 w-12 rounded-full bg-white/10" />
      <span className="relative line-clamp-2 text-sm font-semibold text-white drop-shadow">{name}</span>
    </div>
  );
}

export function CampaignCard({ campaign }: { campaign: CampaignSummaryDTO }) {
  const p = campaign.progress;
  return (
    <Link
      href={`/campaigns/${campaign.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop"
    >
      <CampaignCover
        name={campaign.name}
        coverUrl={campaign.coverUrl}
        primaryColor={campaign.brand.primaryColor}
        accentColor={campaign.brand.accentColor}
      />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{campaign.brand.name}</p>
            <p className="truncate font-semibold">{campaign.name}</p>
          </div>
          <CampaignStatusBadge status={campaign.status} />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Deliverables</span>
            <span className="font-medium text-foreground">
              {p.deliverablesPublished}/{p.deliverablesTotal} published
            </span>
          </div>
          <ProgressBar value={p.deliverableCompletion} tone="brand" />
        </div>

        <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> {p.influencersTotal}
          </span>
          <span>{formatCurrency(p.spend, campaign.currency)}{p.plannedBudget ? ` / ${formatCurrency(p.plannedBudget, campaign.currency)}` : ''}</span>
          {p.daysRemaining != null && p.daysRemaining >= 0 ? (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" /> {p.daysRemaining}d
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
