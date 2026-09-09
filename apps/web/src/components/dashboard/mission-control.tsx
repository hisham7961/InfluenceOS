'use client';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Megaphone,
  PlaySquare,
  ShieldAlert,
  Timer,
  Users,
  Wallet,
} from 'lucide-react';
import type { GlobalDashboardDTO } from '@influenceos/contracts';
import { StatCard } from '@/components/ui/stat-card';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { SectionHeader } from '@/components/common/page-header';
import { ContentGrid } from '@/components/content/content-grid';
import { CampaignCard } from '@/components/campaigns/campaign-card';
import { formatCurrency, relativeTime } from '@/lib/format';

export function MissionControl({ data }: { data: GlobalDashboardDTO }) {
  const p = data.pulse;
  const whatsNewContent = data.whatsNew.map((w) => w.content).filter((c): c is NonNullable<typeof c> => !!c);

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
        {/* What's New */}
        <section>
          <SectionHeader
            title="What's New"
            action={<Link href="/content" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">View wall <ArrowRight className="h-3.5 w-3.5" /></Link>}
          />
          <ContentGrid items={whatsNewContent} className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3" emptyTitle="Nothing published yet" emptyDescription="New influencer content will surface here as it goes live." />
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
