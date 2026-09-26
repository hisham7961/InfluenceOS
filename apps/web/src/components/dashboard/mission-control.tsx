'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
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
import { BidiText } from '@/components/common/bidi-text';
import { formatCurrency, useLocalizedFormat } from '@/lib/format';
import { AttentionItemTitle, AttentionItemDescription } from '@/components/dashboard/attention-item-text';
import { useServerText } from '@/lib/use-server-text';

export function MissionControl({ data, brandId }: { data: GlobalDashboardDTO; brandId?: string }) {
  const st = useServerText();
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const tEmpty = useTranslations('empty');
  const { relativeTime } = useLocalizedFormat();
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

  // Each line's translated noun phrase is looked up by key rather than built
  // via string concatenation — the leading count is rendered separately
  // (bold), so the phrase itself never embeds the number (Arabic uses a
  // stable "N من X" genitive construction that's valid for any count; see
  // docs/localization/README.md's pluralization section).
  const whatsNewLines: { key: string; count: number }[] = [
    { key: 'newContentItemsLine', count: ws.newContent },
    { key: 'campaignsLaunchedLine', count: ws.campaignsLaunched },
    { key: 'contentAlertsLine', count: ws.contentAlerts },
    { key: 'overdueDeliverablesLine', count: ws.overdueDeliverables },
    { key: 'shipmentsDeliveredLine', count: ws.shipmentsDelivered },
    { key: 'draftsApprovedLine', count: ws.submissionsApproved },
    { key: 'usageRightsExpiringLine', count: ws.usageRightsExpiring },
  ].filter((l) => l.count > 0);

  // A brand's own Mission Control opens lists filtered to that brand.
  const scoped = (href: string) => (brandId ? `${href}${href.includes('?') ? '&' : '?'}brandId=${brandId}` : href);

  return (
    <div className="space-y-8">
      {/* Campaign Pulse */}
      <section>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          <StatCard label={t('activeCampaignsStat')} value={p.activeCampaigns} icon={Megaphone} tone="info" href={scoped('/campaigns?status=ACTIVE')} />
          <StatCard label={t('activeInfluencers')} value={p.activeInfluencers} icon={Users} tone="accent" href="/influencers" />
          <StatCard label={t('contentThisWeek')} value={p.contentPublishedThisWeek} icon={PlaySquare} tone="success" href={scoped('/content')} />
          <StatCard label={t('upcomingDeliverables')} value={p.upcomingDeliverables} icon={Timer} tone="neutral" href="/calendar" />
          <StatCard label={t('overdueDeliverables')} value={p.overdueDeliverables} icon={AlertTriangle} tone="danger" href="/calendar" />
          <StatCard
            label={t('totalSpend')}
            value={p.totalSpend}
            icon={Wallet}
            tone="warning"
            format={(n) => formatCurrency(n, p.currency)}
            href={scoped('/campaigns')}
          />
          <StatCard label={t('contentAlerts')} value={p.contentAlerts} icon={ShieldAlert} tone="danger" href={scoped('/content?alerts=1')} />
        </div>
      </section>

      <div className="grid gap-8 xl:grid-cols-[1.6fr_1fr]">
        {/* Since Your Last Visit */}
        <section className="min-w-0">
          <SectionHeader
            title={t('whatsNewSinceVisit')}
            action={
              <Link href={scoped('/content')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                {t('viewWall')} <ArrowRight className="rtl:-scale-x-100 h-3.5 w-3.5" />
              </Link>
            }
          />
          <Card className="p-5">
            {whatsNewLines.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <PartyPopper className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">{t('caughtUp')}</p>
                <p className="text-xs text-muted-foreground">{t('nothingChangedSinceVisit')}</p>
              </div>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {whatsNewLines.map((line) => (
                  <li key={line.key} className="flex items-baseline gap-2">
                    <span className="font-semibold text-foreground">{line.count}</span>
                    <span className="text-muted-foreground">{t(line.key, { count: line.count })}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <ReviewNewContentButton
                brandId={brandId}
                count={newForScope}
                label={brandId ? t('reviewNewVideos', { count: newForScope }) : undefined}
              />
            </div>
            {ws.byBrand.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                {ws.byBrand.slice(0, 6).map((b) => (
                  <span key={b.brandId}>
                    <BidiText as="span">{b.brandName}</BidiText> · <span className="font-medium text-foreground">{b.updates}</span> {t('updatesCount', { count: b.updates })}
                  </span>
                ))}
              </div>
            ) : null}
          </Card>
        </section>

        {/* Needs Attention */}
        <section className="min-w-0">
          <SectionHeader title={t('needsAttention')} />
          <Card className="divide-y divide-border">
            {data.attention.length === 0 ? (
              <EmptyState title={t('allClear')} description={t('noUrgentItems')} className="border-0 shadow-none" />
            ) : (
              data.attention.slice(0, 7).map((item) => (
                <Link key={item.id} href={item.link} className="flex items-start gap-3 p-3.5 transition-colors hover:bg-surface-muted">
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.severity === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}>
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug"><AttentionItemTitle item={item} /></p>
                    <p className="text-xs text-muted-foreground"><AttentionItemDescription item={item} /></p>
                  </div>
                </Link>
              ))
            )}
          </Card>
        </section>
      </div>

      {/* Active Campaigns */}
      <section>
        <SectionHeader title={t('activeCampaigns')} action={<Link href="/campaigns" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">{t('allCampaigns')} <ArrowRight className="rtl:-scale-x-100 h-3.5 w-3.5" /></Link>} />
        {data.activeCampaigns.length === 0 ? (
          <EmptyState icon={Megaphone} title={tEmpty('noCampaigns')} description={t('activeCampaignsWillAppear')} />
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
        <section className="min-w-0">
          <SectionHeader title={t('upcomingContent')} />
          <Card className="divide-y divide-border">
            {data.upcomingContent.length === 0 ? (
              <EmptyState title={t('nothingScheduled')} className="border-0 shadow-none" />
            ) : (
              data.upcomingContent.map((u) => (
                <div key={u.id} className="flex items-center gap-3 p-3.5">
                  <Avatar name={u.influencerName} src={u.influencerAvatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium"><BidiText as="span">{u.influencerName}</BidiText></p>
                    <p className="truncate text-xs text-muted-foreground">
                      <BidiText as="span">{u.brandName}</BidiText> · <BidiText as="span">{u.campaignName}</BidiText>
                    </p>
                  </div>
                  <PlatformIcon platform={u.platform} className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" /> {relativeTime(u.expectedAt)}
                  </span>
                </div>
              ))
            )}
          </Card>
        </section>

        {/* Recent Activity */}
        <section className="min-w-0">
          <SectionHeader title={t('recentActivity')} />
          <Card className="divide-y divide-border">
            {data.recentActivity.length === 0 ? (
              <EmptyState title={tCommon('noActivityYet')} className="border-0 shadow-none" />
            ) : (
              data.recentActivity.map((a) => (
                <div key={a.id} className="flex items-start gap-3 p-3.5">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{st(a.message)}</p>
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
