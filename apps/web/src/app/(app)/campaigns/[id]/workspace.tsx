'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { CampaignDetailDTO, CampaignInfluencerDTO, CostSummaryDTO, ExpenseDTO, ScriptDTO } from '@influenceos/contracts';
import { useConversationUnread } from '@/lib/use-conversation-unread';
import { cn } from '@/lib/cn';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CampaignScriptsContext } from './workspace-shared';
import { WORKSPACE_GROUPS, groupOf, type WorkspaceGroup, type WorkspaceView } from './workspace-groups';

// Each view's code is loaded the first time it's opened (P2.8).
const loading = () => (
  <div className="space-y-3">
    <Skeleton className="h-24 w-full rounded-2xl" />
    <Skeleton className="h-64 w-full rounded-2xl" />
  </div>
);
const OverviewTab = dynamic(() => import('./overview-tab').then((m) => m.OverviewTab), { loading });
const PerformanceTab = dynamic(() => import('./performance-tab').then((m) => m.PerformanceTab), { loading });
const InfluencersTab = dynamic(() => import('./roster-tab').then((m) => m.InfluencersTab), { loading });
const OperationsBoardTab = dynamic(() => import('./operations-board-tab').then((m) => m.OperationsBoardTab), { loading });
const SourcingTab = dynamic(() => import('./sourcing-tab').then((m) => m.SourcingTab), { loading });
const LiveContentTab = dynamic(() => import('./live-content-tab').then((m) => m.LiveContentTab), { loading });
const DeliverablesTab = dynamic(() => import('./deliverables-tab').then((m) => m.DeliverablesTab), { loading });
const SubmissionsTab = dynamic(() => import('./submissions-tab').then((m) => m.SubmissionsTab), { loading });
const ScriptsTab = dynamic(() => import('./scripts-tab').then((m) => m.ScriptsTab), { loading });
const ShipmentsTab = dynamic(() => import('./shipments-tab').then((m) => m.ShipmentsTab), { loading });
const CostsTab = dynamic(() => import('./costs-tab').then((m) => m.CostsTab), { loading });
const ActivityTab = dynamic(() => import('./activity-tab').then((m) => m.ActivityTab), { loading });
const AttachmentsPanel = dynamic(() => import('@/components/common/attachments-panel').then((m) => m.AttachmentsPanel), { loading });
const CommentThread = dynamic(() => import('@/components/collaboration/comment-thread').then((m) => m.CommentThread), { loading });
const TrendsPanel = dynamic(() => import('@/components/reports/trends-panel').then((m) => m.TrendsPanel), { loading });

export interface WorkspaceProps {
  campaign: CampaignDetailDTO;
  influencers: CampaignInfluencerDTO[];
  /** Null when the user has no finance access — the Costs view is left out. */
  costs: { expenses: ExpenseDTO[]; summary: CostSummaryDTO } | null;
  scripts: ScriptDTO[];
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/**
 * The campaign control room: six areas (overview, roster, content,
 * approvals, logistics and budget, collaboration), each with its views.
 * The open view is in the address (`?tab=…`) so links land on it; switching
 * rewrites the address in place rather than asking the server again.
 */
export function Workspace({ campaign, influencers, costs, scripts }: WorkspaceProps) {
  const t = useTranslations('campaigns');
  const discussionUnread = useConversationUnread(`campaign:${campaign.id}`);
  const searchParams = useSearchParams();

  const available = (view: WorkspaceView) => view !== 'costs' || costs !== null;
  const groups = WORKSPACE_GROUPS.map((g) => ({ key: g.key, views: (g.views as readonly WorkspaceView[]).filter(available) }));
  const requested = searchParams.get('tab') as WorkspaceView | null;
  const initialView: WorkspaceView = requested && groups.some((g) => g.views.includes(requested)) ? requested : 'overview';

  const [view, setView] = React.useState<WorkspaceView>(initialView);
  // The view last opened in each area, so going back to an area returns to it.
  const [lastInGroup, setLastInGroup] = React.useState<Partial<Record<WorkspaceGroup, WorkspaceView>>>({
    [groupOf(initialView)]: initialView,
  });
  const group = groupOf(view);

  // Follow the address when it changes under us (a link to another view of this campaign).
  React.useEffect(() => {
    if (requested && requested !== view && groups.some((g) => g.views.includes(requested))) {
      setView(requested);
      setLastInGroup((m) => ({ ...m, [groupOf(requested)]: requested }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  function open(next: WorkspaceView) {
    setView(next);
    setLastInGroup((m) => ({ ...m, [groupOf(next)]: next }));
    const params = new URLSearchParams(window.location.search);
    params.set('tab', next);
    // A plain history update: the app router keeps useSearchParams in sync
    // without a server round trip (a search-param soft navigation can stall).
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
  }

  function renderView(v: WorkspaceView) {
    switch (v) {
      case 'overview':
        return <OverviewTab campaign={campaign} />;
      case 'performance':
        return (
          <div className="space-y-6">
            <PerformanceTab campaignId={campaign.id} />
            <TrendsPanel campaignId={campaign.id} title={t('workspace.trendsTitle')} />
          </div>
        );
      case 'influencers':
        return <InfluencersTab campaign={campaign} influencers={influencers} />;
      case 'operations':
        return <OperationsBoardTab campaignId={campaign.id} />;
      case 'sourcing':
        return <SourcingTab campaignId={campaign.id} currency={campaign.currency} />;
      case 'content':
        return <LiveContentTab campaign={campaign} influencers={influencers} />;
      case 'deliverables':
        return <DeliverablesTab campaign={campaign} influencers={influencers} />;
      case 'submissions':
        return (
          <SubmissionsTab campaignId={campaign.id} campaignName={campaign.name} brandName={campaign.brand.name} influencers={influencers} />
        );
      case 'scripts':
        return <ScriptsTab campaignId={campaign.id} scripts={scripts} />;
      case 'shipments':
        return <ShipmentsTab campaignId={campaign.id} influencers={influencers} />;
      case 'costs':
        return costs ? <CostsTab campaignId={campaign.id} currency={campaign.currency} influencers={influencers} costs={costs} /> : null;
      case 'files':
        return (
          <Card>
            <CardHeader>
              <CardTitle>{t('workspace.filesCardTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <AttachmentsPanel target={{ campaignId: campaign.id }} compact />
            </CardContent>
          </Card>
        );
      case 'activity':
        return <ActivityTab campaignId={campaign.id} />;
      case 'discussion':
        return (
          <Card>
            <CardHeader>
              <CardTitle>{t('workspace.campaignChatTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentThread
                context={{ campaignId: campaign.id }}
                cacheKey={`campaign-chat:${campaign.id}`}
                conversationKey={`campaign:${campaign.id}`}
                emptyTitle={t('workspace.discussion.emptyTitle')}
                emptyDescription={t('workspace.discussion.emptyDescription')}
                composerPlaceholder={t('workspace.discussion.composerPlaceholder')}
              />
            </CardContent>
          </Card>
        );
    }
  }

  return (
    <CampaignScriptsContext.Provider value={scripts}>
      <Tabs value={group} onValueChange={(g) => open(lastInGroup[g as WorkspaceGroup] ?? groups.find((x) => x.key === g)!.views[0]!)}>
        <TabsList className="flex-wrap">
          {groups.map((g) => (
            <TabsTrigger key={g.key} value={g.key} className="gap-1.5">
              {t(`workspace.groups.${g.key}`)}
              {g.key === 'collaboration' ? <Badge count={discussionUnread} /> : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {groups.map((g) => (
          <TabsContent key={g.key} value={g.key}>
            {g.views.length > 1 ? (
              <Tabs value={view} onValueChange={(v) => open(v as WorkspaceView)} className="mb-4">
                <TabsList className="flex-wrap gap-1.5 bg-transparent p-0" aria-label={t(`workspace.groups.${g.key}`)}>
                  {g.views.map((v) => (
                    <TabsTrigger
                      key={v}
                      value={v}
                      className={cn(
                        'gap-1.5 rounded-full border border-border px-3 py-1 text-xs',
                        'data-[state=active]:border-brand data-[state=active]:bg-brand-soft data-[state=active]:text-brand data-[state=active]:shadow-none',
                      )}
                    >
                      {t(`workspace.tabs.${v}`)}
                      {v === 'discussion' ? <Badge count={discussionUnread} /> : null}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}
            {g.key === group ? renderView(view) : null}
          </TabsContent>
        ))}
      </Tabs>
    </CampaignScriptsContext.Provider>
  );
}
