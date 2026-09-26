import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/request';
import { ArrowLeft, CalendarClock, Target, Wallet } from 'lucide-react';
import type { CampaignDetailDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { getServerApi } from '@/lib/api-server';
import { Card, CardContent } from '@/components/ui/card';
import { CampaignStatusBadge } from '@/components/ui/status-badges';
import { CampaignCover } from '@/components/campaigns/campaign-card';
import { ProgressBar } from '@/components/ui/progress';
import { StatCard } from '@/components/ui/stat-card';
import { Avatar } from '@/components/ui/avatar';
import { formatCurrency, shortDate } from '@/lib/format';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { Workspace } from './workspace';
import { CampaignActions } from './campaign-actions';

export const dynamic = 'force-dynamic';

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = getServerApi();
  const t = await getTranslations('campaigns');
  const locale = (await getLocale()) as Locale;

  let campaign: CampaignDetailDTO;
  try {
    campaign = await api.campaigns.get(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const [influencers, costs, scripts] = await Promise.all([
    api.campaigns.influencers(campaign.id),
    api.campaigns.costs(campaign.id),
    api.campaigns.scripts(campaign.id),
  ]);

  const p = campaign.progress;
  const budgetOverspent = (p.budgetUsedPercent ?? 0) > 100;

  return (
    <div>
      <Link
        href="/campaigns"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="rtl:-scale-x-100 h-3.5 w-3.5" /> {t('workspace.backToCampaigns')}
      </Link>

      {/* Hero */}
      <Card className="mb-6 overflow-hidden">
        <CampaignCover
          name={campaign.name}
          coverUrl={campaign.coverUrl}
          primaryColor={campaign.brand.primaryColor}
          accentColor={campaign.brand.accentColor}
          className="h-40 sm:h-56"
        />
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2.5">
            <div className="flex items-center gap-2">
              <Avatar
                name={campaign.brand.name}
                src={campaign.brand.logoUrl ?? campaign.brand.iconUrl}
                size="xs"
                rounded="lg"
              />
              <Link
                href={`/brands/${campaign.brand.id}`}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <BidiText>{campaign.brand.name}</BidiText>
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight">
                <BidiText>{campaign.name}</BidiText>
              </h1>
              <CampaignStatusBadge status={campaign.status} />
            </div>
            {campaign.description ? (
              <p className="max-w-2xl text-sm text-muted-foreground">{campaign.description}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <CampaignActions campaign={campaign} />
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              {campaign.startDate ? shortDate(campaign.startDate, locale) : t('workspace.hero.noStartDate')} –{' '}
              {campaign.endDate ? shortDate(campaign.endDate, locale) : t('workspace.hero.ongoing')}
            </span>
            {p.daysRemaining != null && p.daysRemaining >= 0 ? (
              <span className="text-xs text-muted-foreground">
                {t('workspace.hero.daysRemaining', { days: p.daysRemaining })}
              </span>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Stat row */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{t('workspace.stats.progress')}</span>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Target className="size-5" />
              </span>
            </div>
            <p className="text-3xl font-semibold tracking-tight text-foreground">
              {Math.round(p.deliverableCompletion)}%
            </p>
            <ProgressBar value={p.deliverableCompletion} tone="brand" />
            <p className="text-xs text-muted-foreground">
              {t('workspace.stats.deliverablesProgress', {
                published: p.deliverablesPublished,
                total: p.deliverablesTotal,
              })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{t('workspace.stats.spend')}</span>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
                <Wallet className="size-5" />
              </span>
            </div>
            <p className="text-3xl font-semibold tracking-tight text-foreground">
              <LtrText>{formatCurrency(p.spend, campaign.currency)}</LtrText>
            </p>
            {p.plannedBudget != null ? (
              <>
                <ProgressBar value={p.budgetUsedPercent ?? 0} tone={budgetOverspent ? 'danger' : 'warning'} showLabel />
                <p className="text-xs text-muted-foreground">
                  {t.rich('workspace.stats.ofPlanned', {
                    budget: formatCurrency(p.plannedBudget, campaign.currency),
                    ltr: (chunks) => <LtrText>{chunks}</LtrText>,
                  })}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t('workspace.stats.noBudgetSet')}</p>
            )}
          </CardContent>
        </Card>

        <StatCard
          label={t('workspace.stats.influencers')}
          value={p.influencersTotal}
          iconName="users"
          tone="info"
          hint={t('workspace.stats.influencersCompletedHint', { count: p.influencersCompleted })}
        />
        <StatCard
          label={t('workspace.stats.publishedContent')}
          value={campaign.publishedContentCount}
          iconName="content"
          tone="success"
        />
      </div>

      <Workspace
        campaign={campaign}
        influencers={influencers}
        costs={costs}
        scripts={scripts}
      />
    </div>
  );
}
