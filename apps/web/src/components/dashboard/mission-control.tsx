'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Megaphone,
  PartyPopper,
  PlaySquare,
  ShieldAlert,
  Timer,
  Users,
  Wallet,
} from 'lucide-react';
import type { GlobalDashboardDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { StatCard } from '@/components/ui/stat-card';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { SectionHeader } from '@/components/common/page-header';
import { ReviewNewContentButton } from '@/components/content/review-new-content-button';
import { CampaignCard } from '@/components/campaigns/campaign-card';
import { formatCurrency, relativeTime } from '@/lib/format';

export function MissionControl({ data, brandId }: { data: GlobalDashboardDTO; brandId?: string }) {
  const p = data.pulse;
  const ws = data.whatsNewSummary;
  // On a brand-scoped dashboard (item 41 "Review N New <Brand> Videos"), the
  // CTA must count and review ONLY this brand's new content, not the
  // actor's whole cross-brand backlog.
  const newForScope = brandId
    ? (data.contentSummary.brands.find((b) => b.brandId === brandId)?.new ?? 0)
    : data.contentSummary.new;

  // "Since your last visit" is a real ack, not a passive GET — advance the
  // checkpoint once Mission Control is actually open (item 34-35).
  const ack = useMutation({ mutationFn: () => api.dashboard.whatsNewAck() });
  React.useEffect(() => {
    ack.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const whatsNewLines: { label: string; count: number }[] = [
    { label: 'new content item', count: ws.newContent },
    { label: 'campaign launched', count: ws.campaignsLaunched },
    { label: 'content alert', count: ws.contentAlerts },
    { label: 'overdue deliverable', count: ws.overdueDeliverables },
    { label: 'shipment delivered', count: ws.shipmentsDelivered },
    { label: 'draft approved', count: ws.submissionsApproved },
    { label: 'usage right expiring', count: ws.usageRightsExpiring },
  ].filter((l) => l.count > 0);

  return (
    <div className="space-y-8">
      {/* Campaign Pulse */}
      <section>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          <StatCard label="Active Campaigns" value={p.activeCampaigns} icon={Megaphone} tone="info" />
          <StatCard label="Active Influencers" value={p.activeInfluencers} icon={Users} tone="accent" />
          <StatCard label="Content This Week" value={p.contentPublishedThisWeek} icon={PlaySquare} tone="success" />
          <StatCard label="Upcoming Deliverables" value={p.upcomingDeliverables} icon={Timer} tone="neutral" />
          <StatCard label="Overdue Deliverables" value={p.overdueDeliverables} icon={AlertTriangle} tone="danger" />
          <StatCard label="Total Spend" value={p.totalSpend} icon={Wallet} tone="warning" format={(n) => formatCurrency(n, p.currency)} />
          <StatCard label="Content Alerts" value={p.contentAlerts} icon={ShieldAlert} tone="danger" />
        </div>
      </section>

      <div className="grid gap-8 xl:grid-cols-[1.6fr_1fr]">
        {/* Since Your Last Visit */}
        <section>
          <SectionHeader
            title="Since Your Last Visit"
            action={
              <Link href="/content" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                View wall <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <Card className="p-5">
            {whatsNewLines.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <PartyPopper className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">You&apos;re caught up</p>
                <p className="text-xs text-muted-foreground">Nothing meaningful has changed since your last visit.</p>
              </div>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {whatsNewLines.map((line) => (
                  <li key={line.label} className="flex items-baseline gap-2">
                    <span className="font-semibold text-foreground">{line.count}</span>
                    <span className="text-muted-foreground">
                      {line.label}
                      {line.count === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <ReviewNewContentButton
                brandId={brandId}
                count={newForScope}
                label={brandId ? `Review ${newForScope} New Videos` : undefined}
              />
            </div>
            {ws.byBrand.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                {ws.byBrand.slice(0, 6).map((b) => (
                  <span key={b.brandId}>
                    {b.brandName} · <span className="font-medium text-foreground">{b.updates}</span> update{b.updates === 1 ? '' : 's'}
                  </span>
                ))}
              </div>
            ) : null}
          </Card>
        </section>

        {/* Needs Attention */}
        <section>
          <SectionHeader title="Needs Attention" />
          <Card className="divide-y divide-border">
            {data.attention.length === 0 ? (
              <EmptyState title="All clear" description="No urgent items right now." className="border-0 shadow-none" />
            ) : (
              data.attention.slice(0, 7).map((item) => (
                <Link key={item.id} href={item.link} className="flex items-start gap-3 p-3.5 transition-colors hover:bg-surface-muted">
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.severity === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}>
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </Link>
              ))
            )}
          </Card>
        </section>
      </div>

      {/* Active Campaigns */}
      <section>
        <SectionHeader title="Active Campaigns" action={<Link href="/campaigns" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">All campaigns <ArrowRight className="h-3.5 w-3.5" /></Link>} />
        {data.activeCampaigns.length === 0 ? (
          <EmptyState icon={Megaphone} title="Nothing live right now" description="Active campaigns will appear here." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.activeCampaigns.map((c) => (
              <CampaignCard key={c.campaign.id} campaign={c.campaign} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Upcoming Content */}
        <section>
          <SectionHeader title="Upcoming Content" />
          <Card className="divide-y divide-border">
            {data.upcomingContent.length === 0 ? (
              <EmptyState title="Nothing scheduled" className="border-0 shadow-none" />
            ) : (
              data.upcomingContent.map((u) => (
                <div key={u.id} className="flex items-center gap-3 p-3.5">
                  <Avatar name={u.influencerName} src={u.influencerAvatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{u.influencerName}</p>
                    <p className="truncate text-xs text-muted-foreground">{u.brandName} · {u.campaignName}</p>
                  </div>
                  <PlatformIcon platform={u.platform} className="h-4 w-4 text-muted-foreground" />
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" /> {relativeTime(u.expectedAt)}
                  </span>
                </div>
              ))
            )}
          </Card>
        </section>

        {/* Recent Activity */}
        <section>
          <SectionHeader title="Recent Activity" />
          <Card className="divide-y divide-border">
            {data.recentActivity.length === 0 ? (
              <EmptyState title="No activity yet" className="border-0 shadow-none" />
            ) : (
              data.recentActivity.map((a) => (
                <div key={a.id} className="flex items-start gap-3 p-3.5">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{a.message}</p>
                    <p className="text-xs text-muted-foreground">{relativeTime(a.createdAt)}</p>
                  </div>
                </div>
              ))
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
