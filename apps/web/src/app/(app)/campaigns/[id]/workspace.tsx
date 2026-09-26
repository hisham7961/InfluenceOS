'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  DollarSign,
  Eye,
  FileText,
  Film,
  Heart,
  Link2,
  ListChecks,
  Megaphone,
  MessageSquare,
  Package,
  Pencil,
  Percent as PercentIcon,
  Plus,
  Receipt,
  Target,
  Trash2,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import { EnterMetricsDialog } from '@/components/content/enter-metrics-dialog';
import { BulkMetricsDialog } from '@/components/content/bulk-metrics-dialog';
import type {
  CampaignDetailDTO,
  CampaignEfficiencyDTO,
  CampaignInfluencerDTO,
  CostSummaryDTO,
  DealType,
  DeliverableDTO,
  DeliverableStatus,
  DeliverableType,
  ExpenseDTO,
  ExpenseType,
  InfluencerSummaryDTO,
  LogisticsRequestDTO,
  ParticipationStatus,
  PaymentStatus,
  Platform,
  ProductShipmentDTO,
  ScriptDTO,
} from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import {
  DEAL_TYPES,
  DELIVERABLE_STATUSES,
  DELIVERABLE_TYPES,
  EXPENSE_TYPES,
  PARTICIPATION_STATUSES,
  PAYMENT_STATUSES,
  PLATFORM_META,
  PLATFORMS,
  isDeliverableOutstanding,
  isDeliverableOverdue,
} from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { useConversationUnread } from '@/lib/use-conversation-unread';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { PlatformBadge, PlatformIcon } from '@/components/ui/platform-badge';
import { DealTypeBadge, DeliverableStatusBadge, PaymentStatusBadge } from '@/components/ui/status-badges';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { StatCard } from '@/components/ui/stat-card';
import { ProgressBar } from '@/components/ui/progress';
import { InfoTooltip } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Pagination } from '@/components/ui/pagination';
import { ContentGrid } from '@/components/content/content-grid';
import { AddContentFlow } from '@/components/content/add-content-flow';
import { ReviewNewContentButton } from '@/components/content/review-new-content-button';
import { ActivityFeed } from '@/components/common/activity-feed';
import { CommentThread } from '@/components/collaboration/comment-thread';
import { SourcingTab } from './sourcing-tab';
import { ShipmentsTab } from './shipments-tab';
import { SubmissionsTab } from './submissions-tab';
import { OperationsBoardTab } from './operations-board-tab';
import { formatCompact, formatCurrency, formatPercent, useLocalizedFormat } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AttachmentsPanel } from '@/components/common/attachments-panel';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { WhatsAppDialog } from '@/components/influencers/whatsapp-dialog';
import { PageFooter } from '@/components/ui/page-footer';
import { ShipmentDetailSheet } from '@/app/(app)/logistics/shipment-detail-sheet';
import { AddInfluencerDialog } from './add-influencer-dialog';
import { BulkAddInfluencersDialog } from './bulk-add-influencers-dialog';

/** Sentinel for "no influencer attributed" in the expense form's Select (Radix forbids an empty-string value). */
const NONE = 'none';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : fallback;
}

/** ISO/date string → yyyy-mm-dd for a native date input (local calendar day). */
function toDateInputValue(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Split a comma/newline-separated string into a trimmed, de-duped string[]. */
function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

export interface WorkspaceProps {
  campaign: CampaignDetailDTO;
  influencers: CampaignInfluencerDTO[];
  costs: { expenses: ExpenseDTO[]; summary: CostSummaryDTO };
  scripts: ScriptDTO[];
}

const WORKSPACE_TABS = [
  'overview',
  'sourcing',
  'influencers',
  'operations',
  'deliverables',
  'submissions',
  'scripts',
  'content',
  'shipments',
  'costs',
  'performance',
  'files',
  'activity',
  'discussion',
] as const;

/** The campaign control room — tabs covering everything about one campaign. */
export function Workspace({ campaign, influencers, costs, scripts }: WorkspaceProps) {
  const t = useTranslations('campaigns');
  const discussionUnread = useConversationUnread(`campaign:${campaign.id}`);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep-linkable (Campaign Operations Board / Needs Attention / Creator 360
  // all link here with `?tab=…`) — controlled, seeded from the URL, and kept
  // in sync on every switch so those links actually land on the right tab.
  const requestedTab = searchParams.get('tab');
  const initialTab = WORKSPACE_TABS.find((t) => t === requestedTab) ?? 'overview';
  const [tab, setTab] = React.useState<string>(initialTab);
  function changeTab(next: string) {
    setTab(next);
    router.replace(`/campaigns/${campaign.id}?tab=${next}`, { scroll: false });
  }
  return (
    <Tabs value={tab} onValueChange={changeTab}>
      <TabsList className="flex-wrap">
        <TabsTrigger value="overview">{t('workspace.tabs.overview')}</TabsTrigger>
        <TabsTrigger value="sourcing">{t('workspace.tabs.sourcing')}</TabsTrigger>
        <TabsTrigger value="influencers">{t('workspace.tabs.influencers')}</TabsTrigger>
        <TabsTrigger value="operations">{t('workspace.tabs.operations')}</TabsTrigger>
        <TabsTrigger value="deliverables">{t('workspace.tabs.deliverables')}</TabsTrigger>
        <TabsTrigger value="submissions">{t('workspace.tabs.submissions')}</TabsTrigger>
        <TabsTrigger value="scripts">{t('workspace.tabs.scripts')}</TabsTrigger>
        <TabsTrigger value="content">{t('workspace.tabs.content')}</TabsTrigger>
        <TabsTrigger value="shipments">{t('workspace.tabs.shipments')}</TabsTrigger>
        <TabsTrigger value="costs">{t('workspace.tabs.costs')}</TabsTrigger>
        <TabsTrigger value="performance">{t('workspace.tabs.performance')}</TabsTrigger>
        <TabsTrigger value="files">{t('workspace.tabs.files')}</TabsTrigger>
        <TabsTrigger value="activity">{t('workspace.tabs.activity')}</TabsTrigger>
        <TabsTrigger value="discussion" className="gap-1.5">
          {t('workspace.tabs.discussion')}
          {discussionUnread > 0 ? (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">
              {discussionUnread > 99 ? '99+' : discussionUnread}
            </span>
          ) : null}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <OverviewTab campaign={campaign} />
      </TabsContent>

      <TabsContent value="sourcing">
        <SourcingTab campaignId={campaign.id} />
      </TabsContent>

      <TabsContent value="influencers">
        <InfluencersTab campaign={campaign} influencers={influencers} />
      </TabsContent>

      <TabsContent value="operations">
        <OperationsBoardTab campaignId={campaign.id} />
      </TabsContent>

      <TabsContent value="deliverables">
        <DeliverablesTab campaign={campaign} influencers={influencers} />
      </TabsContent>

      <TabsContent value="submissions">
        <SubmissionsTab campaignId={campaign.id} campaignName={campaign.name} brandName={campaign.brand.name} influencers={influencers} />
      </TabsContent>

      <TabsContent value="scripts">
        <ScriptsTab campaignId={campaign.id} scripts={scripts} />
      </TabsContent>

      <TabsContent value="content">
        <LiveContentTab campaign={campaign} influencers={influencers} />
      </TabsContent>

      <TabsContent value="shipments">
        <ShipmentsTab campaignId={campaign.id} influencers={influencers} />
      </TabsContent>

      <TabsContent value="costs">
        <CostsTab campaignId={campaign.id} currency={campaign.currency} influencers={influencers} costs={costs} />
      </TabsContent>

      <TabsContent value="performance">
        <PerformanceTab campaignId={campaign.id} />
      </TabsContent>

      <TabsContent value="files">
        <Card>
          <CardHeader>
            <CardTitle>{t('workspace.filesCardTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <AttachmentsPanel target={{ campaignId: campaign.id }} compact />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="activity">
        <ActivityTab campaignId={campaign.id} />
      </TabsContent>

      <TabsContent value="discussion">
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
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Live Content — same PublishedContent records as the global Live Content
// page, filtered to this campaign (never a copy — see WORKFLOW_GAP_MATRIX.md).
// ---------------------------------------------------------------------------

const LIVE_CONTENT_PAGE_SIZE = 24;

function LiveContentTab({
  campaign,
  influencers,
}: {
  campaign: CampaignDetailDTO;
  influencers: CampaignInfluencerDTO[];
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [linkedPage, setLinkedPage] = React.useState(1);
  const [unlinkedPage, setUnlinkedPage] = React.useState(1);

  const linkedQuery = useQuery({
    queryKey: ['campaign-content', campaign.id, 'linked', linkedPage],
    queryFn: () => api.campaigns.content(campaign.id, { bucket: 'linked', page: linkedPage, pageSize: LIVE_CONTENT_PAGE_SIZE }),
  });
  // This campaign's own roster influencers' content that isn't linked to it
  // yet — the gap the tab used to hide entirely (previously campaignId-only,
  // hard-capped at 20 with no pagination at all).
  const unlinkedQuery = useQuery({
    queryKey: ['campaign-content', campaign.id, 'unlinked', unlinkedPage],
    queryFn: () => api.campaigns.content(campaign.id, { bucket: 'unlinked', page: unlinkedPage, pageSize: LIVE_CONTENT_PAGE_SIZE }),
    enabled: influencers.length > 0,
  });

  const linked = linkedQuery.data;
  const unlinked = unlinkedQuery.data;
  const linkAll = useMutation({
    mutationFn: () => api.campaigns.linkRosterContent(campaign.id),
    onSuccess: (res) => {
      if (res.linked === 0) toast.message(t('workspace.liveContent.linkAllNone'));
      else toast.success(t('workspace.liveContent.linkAllDone', { count: res.linked }));
      queryClient.invalidateQueries();
      router.refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tCommon('somethingWentWrong')),
  });
  const goToPage = (p: number) => t('workspace.liveContent.goToPage', { page: p });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ReviewNewContentButton campaignId={campaign.id} />
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> {t('workspace.liveContent.addContent')}
        </Button>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t('workspace.liveContent.linkedHeading', { count: linked?.pagination.total ?? 0 })}
        </h3>
        {linkedQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <ContentGrid items={linked?.data ?? []} emptyDescription={t('workspace.liveContent.emptyDescription')} />
            {linked ? (
              <Pagination
                page={linkedPage}
                totalPages={linked.pagination.totalPages}
                onPageChange={setLinkedPage}
                previousLabel={tCommon('previous')}
                nextLabel={tCommon('next')}
                pageAriaLabel={goToPage}
              />
            ) : null}
          </>
        )}
      </div>

      {influencers.length > 0 ? (
        <div className="space-y-3 border-t border-border pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t('workspace.liveContent.unlinkedHeading', { count: unlinked?.pagination.total ?? 0 })}
            </h3>
            {(unlinked?.pagination.total ?? 0) > 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={() => linkAll.mutate()} disabled={linkAll.isPending}>
                <Link2 className="h-3.5 w-3.5" />
                {linkAll.isPending ? tCommon('saving') : t('workspace.liveContent.linkAll')}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t('workspace.liveContent.linkAllHint')}</p>
          {unlinkedQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (unlinked?.data.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">{t('workspace.liveContent.unlinkedEmptyDescription')}</p>
          ) : (
            <>
              <ContentGrid items={unlinked!.data} />
              <Pagination
                page={unlinkedPage}
                totalPages={unlinked!.pagination.totalPages}
                onPageChange={setUnlinkedPage}
                previousLabel={tCommon('previous')}
                nextLabel={tCommon('next')}
                pageAriaLabel={goToPage}
              />
            </>
          )}
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workspace.liveContent.addDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('workspace.liveContent.addDialogDescription', { name: campaign.name })}
            </DialogDescription>
          </DialogHeader>
          <AddContentFlow
            lockCampaignId={campaign.id}
            lockCampaignName={campaign.name}
            rosterScope={influencers}
            onCancel={() => setOpen(false)}
            onSuccess={() => {
              queryClient.invalidateQueries();
              router.refresh();
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function DetailRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-end text-sm font-medium text-foreground">{value || '—'}</span>
    </div>
  );
}

function OverviewTab({ campaign }: { campaign: CampaignDetailDTO }) {
  const t = useTranslations('campaigns');
  const tEnums = useTranslations('enums');
  const { shortDate } = useLocalizedFormat();
  const p = campaign.progress;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('fields.description')}</CardTitle>
          </CardHeader>
          <CardContent>
            {campaign.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{campaign.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('workspace.overview.noDescription')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('newForm.creativeBriefLabel')}</CardTitle>
          </CardHeader>
          <CardContent>
            {campaign.brief ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{campaign.brief}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('workspace.overview.noBrief')}</p>
            )}
          </CardContent>
        </Card>

        {campaign.internalNotes ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('workspace.overview.internalNotesTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-foreground">{campaign.internalNotes}</p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('workspace.overview.progressSummaryTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('workspace.overview.deliverablesPublishedLabel')}</span>
                <span className="font-medium text-foreground">
                  {p.deliverablesPublished}/{p.deliverablesTotal}
                </span>
              </div>
              <ProgressBar value={p.deliverableCompletion} tone="brand" className="mt-1.5" />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('workspace.overview.influencersCompletedLabel')}</span>
                <span className="font-medium text-foreground">
                  {p.influencersCompleted}/{p.influencersTotal}
                </span>
              </div>
              <ProgressBar
                value={p.influencersTotal > 0 ? (p.influencersCompleted / p.influencersTotal) * 100 : 0}
                tone="success"
                className="mt-1.5"
              />
            </div>
            {p.timeElapsedPercent != null ? (
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('workspace.overview.timeElapsedLabel')}</span>
                  <span className="font-medium text-foreground">{formatPercent(p.timeElapsedPercent, 0)}</span>
                </div>
                <ProgressBar value={p.timeElapsedPercent} tone="warning" className="mt-1.5" />
              </div>
            ) : null}
            {p.plannedBudget != null ? (
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('workspace.overview.budgetUsedLabel')}</span>
                  <span className="font-medium text-foreground">{formatPercent(p.budgetUsedPercent, 0)}</span>
                </div>
                <ProgressBar
                  value={p.budgetUsedPercent ?? 0}
                  tone={(p.budgetUsedPercent ?? 0) > 100 ? 'danger' : 'primary'}
                  className="mt-1.5"
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('workspace.overview.detailsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DetailRow
              label={t('fields.objective')}
              value={campaign.objective ? enumLabel(tEnums, 'campaignObjective', campaign.objective) : null}
            />
            <DetailRow label={t('fields.targetMarket')} value={campaign.targetMarket} />
            <DetailRow
              label={t('fields.owner')}
              value={campaign.owner?.name ? <BidiText>{campaign.owner.name}</BidiText> : null}
            />
            <DetailRow label={t('fields.currency')} value={campaign.currency} />
            <DetailRow label={t('fields.created')} value={shortDate(campaign.createdAt)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Influencers
// ---------------------------------------------------------------------------

function InfluencersTab({ campaign, influencers }: { campaign: CampaignDetailDTO; influencers: CampaignInfluencerDTO[] }) {
  const t = useTranslations('campaigns');
  const [addDeliverableFor, setAddDeliverableFor] = React.useState<CampaignInfluencerDTO | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t('workspace.influencers.countOnCampaign', { count: influencers.length })}
        </p>
        <div className="flex items-center gap-2">
          <BulkAddInfluencersDialog campaignId={campaign.id} existingInfluencerIds={influencers.map((ci) => ci.influencer.id)} />
          <AddInfluencerDialog campaignId={campaign.id} existingInfluencerIds={influencers.map((ci) => ci.influencer.id)} />
        </div>
      </div>

      {influencers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('workspace.influencers.emptyTitle')}
          description={t('workspace.influencers.emptyDescription')}
        />
      ) : (
        <div className="space-y-4">
          {influencers.map((ci) => (
            <InfluencerRow key={ci.id} ci={ci} campaign={campaign} onAddDeliverable={() => setAddDeliverableFor(ci)} />
          ))}
        </div>
      )}

      <AddDeliverableDialog
        campaignInfluencer={addDeliverableFor}
        open={addDeliverableFor != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setAddDeliverableFor(null);
        }}
      />
    </div>
  );
}

function InfluencerRow({
  ci,
  campaign,
  onAddDeliverable,
}: {
  ci: CampaignInfluencerDTO;
  campaign: CampaignDetailDTO;
  onAddDeliverable: () => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const router = useRouter();
  const queryClient = useQueryClient();
  const dp = ci.deliverableProgress;
  const [editOpen, setEditOpen] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);

  const remove = useMutation({
    mutationFn: () => api.campaignInfluencers.remove(ci.id),
    onSuccess: () => {
      toast.success(t('workspace.influencers.removedToast'));
      queryClient.invalidateQueries();
      router.refresh();
      setRemoveOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={ci.influencer.displayName} src={ci.influencer.avatarUrl} size="lg" rounded="lg" />
          <div className="min-w-0">
            <Link href={`/influencers/${ci.influencer.id}`} className="truncate font-semibold hover:underline">
              <BidiText>{ci.influencer.displayName}</BidiText>
            </Link>
            {ci.influencer.primaryUsername ? (
              <p className="truncate text-sm text-muted-foreground">
                <LtrText>@{ci.influencer.primaryUsername}</LtrText>
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <DealTypeBadge status={ci.dealType} />
              <PaymentStatusBadge status={ci.paymentStatus} />
              <Badge tone="neutral">{enumLabel(tEnums, 'participationStatus', ci.participationStatus)}</Badge>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {ci.contentCount > 0 ? (
                <Badge tone="success" className="gap-1">
                  <Film className="h-3 w-3" />
                  {t('workspace.influencers.contentLinkedBadge', { count: ci.contentCount })}
                </Badge>
              ) : (
                <Badge tone="warning" className="gap-1">
                  <Film className="h-3 w-3" />
                  {t('workspace.influencers.noContentBadge')}
                </Badge>
              )}
              {ci.allTimeCampaignCount > 1 ? (
                <Badge tone="neutral" className="gap-1">
                  <Megaphone className="h-3 w-3" />
                  {t('workspace.influencers.pastCampaignsBadge', { count: ci.allTimeCampaignCount - 1 })}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <div className="flex items-center gap-1">
            <WhatsAppDialog
              iconOnly
              influencerId={ci.influencer.id}
              creatorName={ci.influencer.displayName}
              purpose={ci.participationStatus === 'INVITED' ? 'OFFER' : 'BRIEF'}
              campaignInfluencerId={ci.id}
              context={{
                campaignName: campaign.name,
                brandName: campaign.brand.name,
                deliverables: ci.deliverables
                  .filter((d) => d.status !== 'CANCELLED')
                  .map((d) => ({ type: d.type, platform: d.platform, dueDate: d.dueDate })),
                fee:
                  ci.agreedCost != null && (ci.dealType === 'PAID' || ci.dealType === 'PAID_PLUS_GIFTED')
                    ? { amount: ci.agreedCost, currency: ci.currency ?? campaign.currency }
                    : null,
                gifted: ci.dealType === 'GIFTED_PRODUCT' || ci.dealType === 'PAID_PLUS_GIFTED',
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('workspace.influencers.linkContentAriaLabel', { name: ci.influencer.displayName })}
              title={t('workspace.influencers.linkContentAriaLabel', { name: ci.influencer.displayName })}
              onClick={() => setLinkOpen(true)}
            >
              <Link2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('workspace.influencers.editAriaLabel', { name: ci.influencer.displayName })}
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('workspace.influencers.removeAriaLabel', { name: ci.influencer.displayName })}
              className="text-muted-foreground hover:text-danger"
              onClick={() => setRemoveOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-lg font-semibold text-foreground">
            {ci.agreedCost != null
              ? <LtrText>{formatCurrency(ci.agreedCost, ci.currency ?? undefined)}</LtrText>
              : ci.dealType === 'GIFTED_PRODUCT'
                ? t('workspace.influencers.gifted')
                : '—'}
          </p>
          {ci.giftedProductValue != null ? (
            <p className="text-xs text-muted-foreground">
              {t.rich('workspace.influencers.giftValue', {
                value: formatCurrency(ci.giftedProductValue, ci.currency ?? undefined),
                ltr: (chunks) => <LtrText>{chunks}</LtrText>,
              })}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {t('workspace.influencers.deliveredCount', { published: dp.published, total: dp.total })}
          </p>
        </div>
      </div>

      <EditInfluencerDialog ci={ci} open={editOpen} onOpenChange={setEditOpen} />
      <LinkExistingContentDialog ci={ci} campaign={campaign} open={linkOpen} onOpenChange={setLinkOpen} />
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t('workspace.influencers.removeConfirmTitle')}
        description={t('workspace.influencers.removeConfirmDescription', { name: ci.influencer.displayName })}
        confirmLabel={tCommon('remove')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />

      <div className="border-t border-border bg-surface-muted/40 p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('card.deliverablesLabel')}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={onAddDeliverable}>
            <Plus className="h-3.5 w-3.5" /> {t('workspace.deliverables.addDeliverable')}
          </Button>
        </div>
        {ci.deliverables.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('workspace.deliverables.emptyShort')}</p>
        ) : (
          <div className="space-y-2">
            {ci.deliverables.map((d) => (
              <DeliverableRow key={d.id} deliverable={d} campaign={campaign} influencer={ci.influencer} campaignInfluencerId={ci.id} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Links an already-published content row to this campaign, for the common
 * case where content was added independently of this campaign (e.g. via
 * Quick Add or from the influencer's own profile) before — or instead of —
 * being added through this campaign's own "Add content" flow (which only
 * ever creates a NEW row). Reuses the exact same PATCH /content/:id +
 * resolveContentAssociation validation ContentAssociationPanel uses on a
 * content item's own page — this is just a picker in front of the same call,
 * scoped to one roster member so every candidate is guaranteed to satisfy
 * the "influencer must already be on this campaign's roster" rule server-side.
 */
function LinkExistingContentDialog({
  ci,
  campaign,
  open,
  onOpenChange,
}: {
  ci: CampaignInfluencerDTO;
  campaign: CampaignDetailDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();

  const contentQuery = useQuery({
    queryKey: ['influencer-content-for-link', ci.influencer.id],
    queryFn: () => api.content.feed({ influencerId: ci.influencer.id, limit: 50 }),
    enabled: open,
  });
  const candidates = (contentQuery.data?.data ?? []).filter((c) => c.campaign?.id !== campaign.id);

  const [linkingId, setLinkingId] = React.useState<string | null>(null);
  const link = useMutation({
    mutationFn: (contentId: string) => api.content.update(contentId, { campaignId: campaign.id }),
    onMutate: (contentId) => setLinkingId(contentId),
    onSuccess: () => {
      toast.success(t('workspace.liveContent.linkedToast'));
      queryClient.invalidateQueries();
      router.refresh();
      contentQuery.refetch();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
    onSettled: () => setLinkingId(null),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workspace.liveContent.linkDialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('workspace.liveContent.linkDialogDescription', { name: ci.influencer.displayName, campaign: campaign.name })}
          </DialogDescription>
        </DialogHeader>

        {contentQuery.isLoading ? (
          <Spinner className="mx-auto" />
        ) : candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('workspace.liveContent.noLinkCandidates')}</p>
        ) : (
          <div className="space-y-2">
            {candidates.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                {c.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.thumbnailUrl} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="h-12 w-12 shrink-0 rounded-md bg-surface-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PlatformBadge platform={c.platform} size="sm" />
                    {c.campaign ? (
                      <Badge tone="warning">{t('workspace.liveContent.linkedElsewhere', { campaign: c.campaign.name })}</Badge>
                    ) : null}
                  </div>
                  {c.caption ? <p className="truncate text-sm text-foreground">{c.caption}</p> : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={link.isPending && linkingId === c.id}
                  onClick={() => link.mutate(c.id)}
                >
                  {link.isPending && linkingId === c.id ? <Spinner className="text-current" /> : t('workspace.liveContent.linkButton')}
                </Button>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditInfluencerDialog({
  ci,
  open,
  onOpenChange,
}: {
  ci: CampaignInfluencerDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dealType, setDealType] = React.useState<DealType>(ci.dealType);
  const [agreedCost, setAgreedCost] = React.useState(ci.agreedCost != null ? String(ci.agreedCost) : '');
  const [giftedProductValue, setGiftedProductValue] = React.useState(
    ci.giftedProductValue != null ? String(ci.giftedProductValue) : '',
  );
  const [participationStatus, setParticipationStatus] = React.useState<ParticipationStatus>(ci.participationStatus);
  const [paymentStatus, setPaymentStatus] = React.useState<PaymentStatus>(ci.paymentStatus);
  const [notes, setNotes] = React.useState(ci.notes ?? '');

  React.useEffect(() => {
    if (open) {
      setDealType(ci.dealType);
      setAgreedCost(ci.agreedCost != null ? String(ci.agreedCost) : '');
      setGiftedProductValue(ci.giftedProductValue != null ? String(ci.giftedProductValue) : '');
      setParticipationStatus(ci.participationStatus);
      setPaymentStatus(ci.paymentStatus);
      setNotes(ci.notes ?? '');
    }
  }, [open, ci]);

  const save = useMutation({
    mutationFn: () => {
      const cost = agreedCost.trim();
      const gift = giftedProductValue.trim();
      if (cost !== '' && !Number.isFinite(Number(cost))) throw new Error(t('workspace.influencers.invalidAgreedCost'));
      if (gift !== '' && !Number.isFinite(Number(gift))) throw new Error(t('workspace.influencers.invalidGiftValue'));
      return api.campaignInfluencers.update(ci.id, {
        dealType,
        agreedCost: cost === '' ? null : Number(cost),
        giftedProductValue: gift === '' ? null : Number(gift),
        participationStatus,
        paymentStatus,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success(t('workspace.influencers.updatedToast'));
      queryClient.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('workspace.influencers.editDialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('workspace.influencers.editDialogDescription', { name: ci.influencer.displayName })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('fields.dealType')}>
            <Select value={dealType} onValueChange={(v) => setDealType(v as DealType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEAL_TYPES.map((d) => (
                  <SelectItem key={d} value={d}>
                    {enumLabel(tEnums, 'dealType', d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('workspace.influencers.agreedCostLabel')} hint={t('workspace.influencers.agreedCostHint')}>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={agreedCost}
              onChange={(e) => setAgreedCost(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label={t('workspace.influencers.giftValueLabel')} hint={t('fields.optionalHint')}>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={giftedProductValue}
              onChange={(e) => setGiftedProductValue(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label={t('fields.participationStatus')}>
            <Select value={participationStatus} onValueChange={(v) => setParticipationStatus(v as ParticipationStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PARTICIPATION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {enumLabel(tEnums, 'participationStatus', s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('fields.paymentStatus')} className="col-span-2">
            <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as PaymentStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {enumLabel(tEnums, 'paymentStatus', s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('fields.notes')} hint={t('fields.optionalHint')} className="col-span-2">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? tCommon('saving') : t('workspace.saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Deliverables (shared row + flat cross-influencer tab)
// ---------------------------------------------------------------------------

function DeliverableRow({
  deliverable,
  campaign,
  influencer,
  campaignInfluencerId,
  influencerName,
  influencerAvatar,
}: {
  deliverable: DeliverableDTO;
  /** Needed to open this deliverable's shipment(s) in the shared ShipmentDetailSheet
   *  (that sheet reads a LogisticsRequestDTO, which carries campaign/brand/creator context). */
  campaign: CampaignDetailDTO;
  influencer?: InfluencerSummaryDTO;
  campaignInfluencerId?: string;
  influencerName?: string;
  influencerAvatar?: string | null;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const { shortDate } = useLocalizedFormat();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [addContentOpen, setAddContentOpen] = React.useState(false);
  const [submitDraftOpen, setSubmitDraftOpen] = React.useState(false);
  const [commentsOpen, setCommentsOpen] = React.useState(false);
  const typeLabel = enumLabel(tEnums, 'deliverableType', deliverable.type);

  const updateStatus = useMutation({
    mutationFn: (status: DeliverableStatus) => api.deliverables.update(deliverable.id, { status }),
    onSuccess: () => {
      toast.success(t('workspace.deliverables.statusUpdatedToast'));
      queryClient.invalidateQueries();
      router.refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const remove = useMutation({
    mutationFn: () => api.deliverables.remove(deliverable.id),
    onSuccess: () => {
      toast.success(t('workspace.deliverables.removedToast'));
      queryClient.invalidateQueries();
      router.refresh();
      setRemoveOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  // Shared rule: overdue once the due day has fully passed in Kuwait, for
  // work that is still owed (an approved post not yet up still counts).
  const isOverdue = isDeliverableOverdue(deliverable);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      {influencerName ? (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={influencerName} src={influencerAvatar} size="xs" />
          <span className="truncate text-sm font-medium">
            <BidiText>{influencerName}</BidiText>
          </span>
        </div>
      ) : null}

      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        <PlatformIcon platform={deliverable.platform} className="h-4 w-4 text-muted-foreground" />
        {typeLabel}
        {deliverable.quantity > 1 ? ` ×${deliverable.quantity}` : ''}
      </span>

      {deliverable.dueDate ? (
        <span className={cn('flex items-center gap-1 text-xs', isOverdue ? 'font-medium text-danger' : 'text-muted-foreground')}>
          <Clock className="h-3.5 w-3.5" /> {t('workspace.deliverables.dueLabel', { date: shortDate(deliverable.dueDate) })}
        </span>
      ) : null}

      {deliverable.publishedUrl ? (
        <a href={deliverable.publishedUrl} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">
          {t('workspace.deliverables.viewPublished')}
        </a>
      ) : null}

      {deliverable.requiresProduct ? (
        <Badge tone="warning" className="inline-flex items-center gap-1">
          <Package className="h-3 w-3" /> {t('workspace.deliverables.needsProduct')}
        </Badge>
      ) : null}

      <Button type="button" variant="ghost" size="sm" onClick={() => setAddContentOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> {t('workspace.liveContent.addContent')}
      </Button>
      {deliverable.type === 'UGC' ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setSubmitDraftOpen(true)}>
          <FileText className="h-3.5 w-3.5" /> {t('workspace.deliverables.submitDraft')}
        </Button>
      ) : null}
      <Button type="button" variant="ghost" size="sm" onClick={() => setCommentsOpen(true)}>
        <MessageSquare className="h-3.5 w-3.5" /> {t('workspace.deliverables.comments')}
      </Button>
      {influencer && isDeliverableOutstanding(deliverable) ? (
        <WhatsAppDialog
          influencerId={influencer.id}
          creatorName={influencer.displayName}
          purpose={deliverable.status === 'CHANGES_REQUESTED' ? 'CHANGES' : 'BRIEF'}
          campaignInfluencerId={campaignInfluencerId}
          context={{
            campaignName: campaign.name,
            brandName: campaign.brand.name,
            deliverables: [{ type: deliverable.type, platform: deliverable.platform, dueDate: deliverable.dueDate }],
            requirements: deliverable.requirements,
            hashtags: deliverable.requiredHashtags,
            mentions: deliverable.requiredMentions,
          }}
        />
      ) : null}
      <DeliverableShipmentsAction deliverable={deliverable} campaign={campaign} influencer={influencer} />

      <div className="ms-auto flex items-center gap-2">
        <DeliverableStatusBadge status={deliverable.status} />
        <Select
          value={deliverable.status}
          onValueChange={(v) => updateStatus.mutate(v as DeliverableStatus)}
          disabled={updateStatus.isPending}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DELIVERABLE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {enumLabel(tEnums, 'deliverableStatus', s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('workspace.deliverables.removeAriaLabel')}
          className="text-muted-foreground hover:text-danger"
          onClick={() => setRemoveOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t('workspace.deliverables.removeConfirmTitle')}
        description={t('workspace.deliverables.removeConfirmDescription', { type: typeLabel })}
        confirmLabel={tCommon('remove')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />

      <Dialog open={addContentOpen} onOpenChange={setAddContentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workspace.liveContent.addDialogTitle')}</DialogTitle>
            <DialogDescription>
              {influencerName
                ? t('workspace.deliverables.addContentDescriptionNamed', { name: influencerName, type: typeLabel })
                : t('workspace.deliverables.addContentDescriptionGeneric', { type: typeLabel })}
            </DialogDescription>
          </DialogHeader>
          <AddContentFlow
            lockDeliverableId={deliverable.id}
            lockDeliverableLabel={
              influencerName
                ? t('workspace.deliverables.lockLabelNamed', { name: influencerName, type: typeLabel })
                : typeLabel
            }
            onCancel={() => setAddContentOpen(false)}
            onSuccess={() => {
              queryClient.invalidateQueries();
              router.refresh();
              setAddContentOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <SubmitDraftDialog
        deliverableId={deliverable.id}
        open={submitDraftOpen}
        onOpenChange={setSubmitDraftOpen}
      />

      <Dialog open={commentsOpen} onOpenChange={setCommentsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {influencerName
                ? t('workspace.deliverables.commentsDialogTitleNamed', { name: influencerName, type: typeLabel })
                : t('workspace.deliverables.commentsDialogTitleGeneric', { type: typeLabel })}
            </DialogTitle>
          </DialogHeader>
          <CommentThread
            context={{ deliverableId: deliverable.id }}
            cacheKey={`deliverable:${deliverable.id}`}
            emptyTitle={t('workspace.deliverables.commentsEmptyTitle')}
            emptyDescription={t('workspace.deliverables.commentsEmptyDescription')}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Opens this deliverable's shipment(s) in the SAME ShipmentDetailSheet the
 * `/logistics` workspace and the campaign's own Shipments tab use — never a
 * second shipment detail view. A Deliverable can have several shipments
 * (ProductShipment.deliverableId is a one-to-many FK: replacements, retries),
 * so more than one opens a small picker instead of guessing which to show.
 * ShipmentDetailSheet reads a LogisticsRequestDTO (shipment + creator/brand/
 * campaign context) rather than the bare ProductShipmentDTO
 * `GET /deliverables/:id/shipments` returns — that context is assembled here
 * from what this row already has in scope, with no extra round trip.
 */
function DeliverableShipmentsAction({
  deliverable,
  campaign,
  influencer,
}: {
  deliverable: DeliverableDTO;
  campaign: CampaignDetailDTO;
  influencer?: InfluencerSummaryDTO;
}) {
  const t = useTranslations('campaigns');
  const tEnums = useTranslations('enums');
  const queryClient = useQueryClient();
  const [selected, setSelected] = React.useState<LogisticsRequestDTO | null>(null);
  // Shipments are only ever created for deliverables that need a product —
  // skip the request entirely for the common case (a pure content deliverable).
  const shipmentsQuery = useQuery({
    queryKey: ['deliverable-shipments', deliverable.id],
    queryFn: () => api.deliverables.shipments(deliverable.id),
    enabled: deliverable.requiresProduct,
  });
  const shipments = shipmentsQuery.data ?? [];
  if (!deliverable.requiresProduct || shipments.length === 0) return null;

  function toDetail(s: ProductShipmentDTO): LogisticsRequestDTO {
    return {
      ...s,
      influencer: influencer ? { id: influencer.id, displayName: influencer.displayName, avatarUrl: influencer.avatarUrl, countryCode: null } : null,
      brand: { id: campaign.brandId, name: campaign.brand.name },
      campaign: { id: campaign.id, name: campaign.name },
      deliverableType: deliverable.type,
    };
  }

  function close(open: boolean) {
    if (open) return;
    setSelected(null);
    queryClient.invalidateQueries({ queryKey: ['deliverable-shipments', deliverable.id] });
  }

  if (shipments.length === 1) {
    return (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(toDetail(shipments[0]!))}>
          <Truck className="h-3.5 w-3.5" /> {t('workspace.deliverables.shipmentSingular')}
        </Button>
        <ShipmentDetailSheet shipment={selected} onOpenChange={close} />
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm">
            <Truck className="h-3.5 w-3.5" /> {t('workspace.deliverables.shipmentsCount', { count: shipments.length })}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {shipments.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => setSelected(toDetail(s))}>
              {enumLabel(tEnums, 'shipmentStatus', s.status)} ·{' '}
              {[s.city, s.country].filter(Boolean).join(', ') || t('workspace.deliverables.noDestinationOnFile')}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ShipmentDetailSheet shipment={selected} onOpenChange={close} />
    </>
  );
}

/**
 * UGC drafts go through DeliverableSubmission review, never PublishedContent —
 * no public URL is required to complete this workflow (submission.service.ts
 * review()'s APPROVE path never creates a PublishedContent row).
 */
function SubmitDraftDialog({
  deliverableId,
  open,
  onOpenChange,
}: {
  deliverableId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [assetUrl, setAssetUrl] = React.useState('');
  const [notes, setNotes] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setAssetUrl('');
      setNotes('');
    }
  }, [open]);

  const submit = useMutation({
    mutationFn: () => api.deliverables.submit(deliverableId, { assetUrl: assetUrl.trim() || undefined, notes: notes.trim() || undefined }),
    onSuccess: () => {
      toast.success(t('workspace.deliverables.draftSubmittedToast'));
      queryClient.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('workspace.deliverables.submitDraftDialogTitle')}</DialogTitle>
          <DialogDescription>{t('workspace.deliverables.submitDraftDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t('workspace.deliverables.assetLinkLabel')} hint={t('workspace.deliverables.assetLinkHint')}>
            <Input value={assetUrl} onChange={(e) => setAssetUrl(e.target.value)} placeholder="https://drive.google.com/…" />
          </Field>
          <Field label={t('fields.notes')} hint={t('workspace.deliverables.notesReviewerHint')}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? t('workspace.deliverables.submitting') : t('workspace.deliverables.submitForReview')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeliverablesTab({ campaign, influencers }: { campaign: CampaignDetailDTO; influencers: CampaignInfluencerDTO[] }) {
  const t = useTranslations('campaigns');
  const rows = React.useMemo(() => {
    const flat = influencers.flatMap((ci) => ci.deliverables.map((d) => ({ ci, d })));
    return flat.sort((a, b) => {
      const at = a.d.dueDate ? new Date(a.d.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bt = b.d.dueDate ? new Date(b.d.dueDate).getTime() : Number.POSITIVE_INFINITY;
      return at - bt;
    });
  }, [influencers]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title={t('workspace.deliverables.emptyTitle')}
        description={t('workspace.deliverables.emptyDescription')}
      />
    );
  }

  return (
    <div className="space-y-2">
      {rows.map(({ ci, d }) => (
        <DeliverableRow
          key={d.id}
          deliverable={d}
          campaign={campaign}
          influencer={ci.influencer}
          campaignInfluencerId={ci.id}
          influencerName={ci.influencer.displayName}
          influencerAvatar={ci.influencer.avatarUrl}
        />
      ))}
    </div>
  );
}

function AddDeliverableDialog({
  campaignInfluencer,
  open,
  onOpenChange,
}: {
  campaignInfluencer: CampaignInfluencerDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [platform, setPlatform] = React.useState<Platform>('INSTAGRAM');
  const [type, setType] = React.useState<DeliverableType>('POST');
  const [quantity, setQuantity] = React.useState('1');
  const [dueDate, setDueDate] = React.useState('');
  const [requirements, setRequirements] = React.useState('');
  const [requiresProduct, setRequiresProduct] = React.useState(false);

  React.useEffect(() => {
    if (campaignInfluencer) {
      setPlatform(campaignInfluencer.influencer.primaryPlatform ?? 'INSTAGRAM');
      setType('POST');
      setQuantity('1');
      setDueDate('');
      setRequirements('');
      setRequiresProduct(false);
    }
  }, [campaignInfluencer]);

  const addDeliverable = useMutation({
    mutationFn: () => {
      if (!campaignInfluencer) throw new Error(t('workspace.deliverables.noInfluencerSelected'));
      return api.campaignInfluencers.addDeliverable(campaignInfluencer.id, {
        platform,
        type,
        quantity: Number(quantity) || 1,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        requirements: requirements.trim() || undefined,
        requiresProduct,
      });
    },
    onSuccess: () => {
      toast.success(t('workspace.deliverables.addedToast'));
      queryClient.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('workspace.deliverables.addDeliverable')}</DialogTitle>
          <DialogDescription>
            {campaignInfluencer
              ? t('workspace.deliverables.addDialogDescriptionNamed', { name: campaignInfluencer.influencer.displayName })
              : t('workspace.deliverables.addDialogDescriptionGeneric')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('fields.platform')}>
            <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PLATFORM_META[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('fields.type')}>
            <Select value={type} onValueChange={(v) => setType(v as DeliverableType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIVERABLE_TYPES.map((dt) => (
                  <SelectItem key={dt} value={dt}>
                    {enumLabel(tEnums, 'deliverableType', dt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('fields.quantity')}>
            <Input type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label={t('fields.dueDate')} hint={t('fields.optionalHint')}>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label={t('workspace.deliverables.requirementsLabel')} hint={t('fields.optionalHint')} className="col-span-2">
            <Textarea
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder={t('workspace.deliverables.requirementsPlaceholder')}
              rows={3}
            />
          </Field>
          <div className="col-span-2 flex items-center justify-between rounded-lg border border-border bg-surface-muted px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-foreground">{t('workspace.deliverables.physicalProductRequired')}</p>
              <p className="text-xs text-muted-foreground">
                {t('workspace.deliverables.physicalProductRequiredDescription')}
              </p>
            </div>
            <Switch
              aria-label={t('workspace.deliverables.physicalProductRequired')}
              checked={requiresProduct}
              onCheckedChange={setRequiresProduct}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={addDeliverable.isPending} onClick={() => addDeliverable.mutate()}>
            {addDeliverable.isPending ? t('workspace.deliverables.adding') : t('workspace.deliverables.addDeliverable')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

type TagTone = 'success' | 'danger' | 'info' | 'neutral' | 'accent';

function TagList({ label, items, tone }: { label: string; items: string[]; tone: TagTone }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <Badge key={`${item}-${i}`} tone={tone}>
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function ScriptsTab({ campaignId, scripts }: { campaignId: string; scripts: ScriptDTO[] }) {
  const t = useTranslations('campaigns');
  const { relativeTime } = useLocalizedFormat();
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [newOpen, setNewOpen] = React.useState(false);
  const [addVersionFor, setAddVersionFor] = React.useState<ScriptDTO | null>(null);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t('workspace.scripts.countForCampaign', { count: scripts.length })}
        </p>
        <Button type="button" size="sm" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4" /> {t('workspace.scripts.newScript')}
        </Button>
      </div>

      {scripts.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t('workspace.scripts.emptyTitle')}
          description={t('workspace.scripts.emptyDescription')}
        />
      ) : (
        scripts.map((script) => {
          const current = script.versions.find((v) => v.version === script.currentVersion) ?? script.versions[0];
          const isOpen = expanded.has(script.id);

          return (
            <Card key={script.id} className="overflow-hidden">
              <div className="flex items-center gap-2 pe-3">
                <button
                  type="button"
                  onClick={() => toggle(script.id)}
                  className="flex flex-1 items-center justify-between gap-3 p-5 text-start transition-colors hover:bg-surface-muted"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                      <FileText className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        <BidiText>{script.title}</BidiText>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('workspace.scripts.versionUpdated', {
                          version: script.currentVersion,
                          relative: relativeTime(script.updatedAt),
                        })}
                      </p>
                    </div>
                  </div>
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="rtl:-scale-x-100 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAddVersionFor(script)}>
                  <Plus className="h-3.5 w-3.5" /> {t('workspace.scripts.addVersion')}
                </Button>
              </div>

              {isOpen && current ? (
                <div className="space-y-4 border-t border-border p-5">
                {current.body ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('workspace.scripts.scriptLabel')}
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{current.body}</p>
                  </div>
                ) : null}
                {current.captionSuggestion ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('workspace.scripts.captionSuggestionLabel')}
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{current.captionSuggestion}</p>
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <TagList label={t('workspace.scripts.dos')} items={current.dos} tone="success" />
                  <TagList label={t('workspace.scripts.donts')} items={current.donts} tone="danger" />
                  <TagList label={t('workspace.scripts.talkingPoints')} items={current.talkingPoints} tone="info" />
                  <TagList label={t('workspace.scripts.requiredClaims')} items={current.requiredClaims} tone="neutral" />
                  <TagList
                    label={t('workspace.scripts.hashtags')}
                    items={current.hashtags.map((h) => `#${h}`)}
                    tone="accent"
                  />
                  <TagList
                    label={t('workspace.scripts.mentions')}
                    items={current.mentions.map((m) => `@${m}`)}
                    tone="accent"
                  />
                </div>

                {current.referenceLinks.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('workspace.scripts.referenceLinks')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {current.referenceLinks.map((link) => (
                        <a
                          key={link}
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-brand hover:underline"
                        >
                          <LtrText>{link}</LtrText>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                {current.internalComments ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('workspace.scripts.internalCommentsLabel')}
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{current.internalComments}</p>
                  </div>
                ) : null}

                {current.createdByName ? (
                  <p className="text-xs text-muted-foreground">
                    {t('workspace.scripts.writtenBy', { name: current.createdByName })}
                  </p>
                ) : null}
              </div>
            ) : null}
              </Card>
            );
          })
      )}

      <NewScriptDialog campaignId={campaignId} open={newOpen} onOpenChange={setNewOpen} />
      <AddScriptVersionDialog
        script={addVersionFor}
        open={addVersionFor != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setAddVersionFor(null);
        }}
      />
    </div>
  );
}

/** Shared editable state for a single script version's main fields. */
function useScriptVersionFields() {
  const [body, setBody] = React.useState('');
  const [talkingPoints, setTalkingPoints] = React.useState('');
  const [dos, setDos] = React.useState('');
  const [donts, setDonts] = React.useState('');
  const [hashtags, setHashtags] = React.useState('');
  const [mentions, setMentions] = React.useState('');

  function reset() {
    setBody('');
    setTalkingPoints('');
    setDos('');
    setDonts('');
    setHashtags('');
    setMentions('');
  }

  function buildVersion() {
    return {
      body: body.trim() || null,
      talkingPoints: splitList(talkingPoints),
      dos: splitList(dos),
      donts: splitList(donts),
      hashtags: splitList(hashtags).map((h) => h.replace(/^#/, '')),
      mentions: splitList(mentions).map((m) => m.replace(/^@/, '')),
    };
  }

  return {
    body,
    setBody,
    talkingPoints,
    setTalkingPoints,
    dos,
    setDos,
    donts,
    setDonts,
    hashtags,
    setHashtags,
    mentions,
    setMentions,
    reset,
    buildVersion,
  };
}

function ScriptVersionFields({ fields }: { fields: ReturnType<typeof useScriptVersionFields> }) {
  const t = useTranslations('campaigns');
  const f = fields;
  return (
    <div className="space-y-4">
      <Field label={t('workspace.scripts.scriptBodyLabel')} hint={t('fields.optionalHint')}>
        <Textarea
          value={f.body}
          onChange={(e) => f.setBody(e.target.value)}
          rows={4}
          placeholder={t('workspace.scripts.scriptBodyPlaceholder')}
        />
      </Field>
      <Field label={t('workspace.scripts.talkingPoints')} hint={t('workspace.scripts.commaSeparatedHint')}>
        <Textarea
          value={f.talkingPoints}
          onChange={(e) => f.setTalkingPoints(e.target.value)}
          rows={2}
          placeholder={t('workspace.scripts.talkingPointsPlaceholder')}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('workspace.scripts.dos')} hint={t('workspace.scripts.commaSeparatedHint')}>
          <Textarea
            value={f.dos}
            onChange={(e) => f.setDos(e.target.value)}
            rows={2}
            placeholder={t('workspace.scripts.dosPlaceholder')}
          />
        </Field>
        <Field label={t('workspace.scripts.donts')} hint={t('workspace.scripts.commaSeparatedHint')}>
          <Textarea
            value={f.donts}
            onChange={(e) => f.setDonts(e.target.value)}
            rows={2}
            placeholder={t('workspace.scripts.dontsPlaceholder')}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('workspace.scripts.hashtags')} hint={t('workspace.scripts.commaSeparatedHint')}>
          <Input
            value={f.hashtags}
            onChange={(e) => f.setHashtags(e.target.value)}
            placeholder={t('workspace.scripts.hashtagsPlaceholder')}
          />
        </Field>
        <Field label={t('workspace.scripts.mentions')} hint={t('workspace.scripts.commaSeparatedHint')}>
          <Input
            value={f.mentions}
            onChange={(e) => f.setMentions(e.target.value)}
            placeholder={t('workspace.scripts.mentionsPlaceholder')}
          />
        </Field>
      </div>
    </div>
  );
}

function NewScriptDialog({
  campaignId,
  open,
  onOpenChange,
}: {
  campaignId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = React.useState('');
  const fields = useScriptVersionFields();

  React.useEffect(() => {
    if (open) {
      setTitle('');
      fields.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const create = useMutation({
    mutationFn: () => {
      const trimmed = title.trim();
      if (!trimmed) throw new Error(t('workspace.scripts.enterTitleError'));
      return api.scripts.create({ campaignId, title: trimmed, ...fields.buildVersion() });
    },
    onSuccess: () => {
      toast.success(t('workspace.scripts.createdToast'));
      queryClient.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workspace.scripts.newScript')}</DialogTitle>
          <DialogDescription>{t('workspace.scripts.newScriptDialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t('fields.title')}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('workspace.scripts.titlePlaceholder')}
            />
          </Field>
          <ScriptVersionFields fields={fields} />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? t('workspace.scripts.creating') : t('workspace.scripts.createScript')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddScriptVersionDialog({
  script,
  open,
  onOpenChange,
}: {
  script: ScriptDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const fields = useScriptVersionFields();

  React.useEffect(() => {
    if (open) fields.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addVersion = useMutation({
    mutationFn: () => {
      if (!script) throw new Error(t('workspace.scripts.noScriptSelected'));
      return api.scripts.addVersion(script.id, fields.buildVersion());
    },
    onSuccess: () => {
      toast.success(t('workspace.scripts.versionAddedToast'));
      queryClient.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workspace.scripts.addVersion')}</DialogTitle>
          <DialogDescription>
            {script
              ? t('workspace.scripts.addVersionDescriptionNamed', { title: script.title })
              : t('workspace.scripts.addVersionDescriptionGeneric')}
          </DialogDescription>
        </DialogHeader>

        <ScriptVersionFields fields={fields} />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={addVersion.isPending} onClick={() => addVersion.mutate()}>
            {addVersion.isPending ? t('workspace.scripts.addingVersion') : t('workspace.scripts.addVersion')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

function ExpenseRow({ expense }: { expense: ExpenseDTO }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const { shortDate } = useLocalizedFormat();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);

  const remove = useMutation({
    mutationFn: () => api.expenses.remove(expense.id),
    onSuccess: () => {
      toast.success(t('workspace.expenses.removedToast'));
      queryClient.invalidateQueries();
      router.refresh();
      setRemoveOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const typeLabel = enumLabel(tEnums, 'expenseType', expense.type);
  const name = expense.label || typeLabel;

  return (
    <div className="flex items-center gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
        <Receipt className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          <BidiText>{name}</BidiText>
        </p>
        <p className="text-xs text-muted-foreground">
          {typeLabel} · {expense.incurredAt ? shortDate(expense.incurredAt) : t('workspace.expenses.noDate')}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <LtrText as="span" className="text-sm font-semibold text-foreground">{formatCurrency(expense.amount, expense.currency)}</LtrText>
        <PaymentStatusBadge status={expense.paymentStatus} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('workspace.expenses.editAriaLabel', { name })}
          onClick={() => setEditOpen(true)}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('workspace.expenses.removeAriaLabel', { name })}
          className="text-muted-foreground hover:text-danger"
          onClick={() => setRemoveOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <EditExpenseDialog expense={expense} open={editOpen} onOpenChange={setEditOpen} />
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t('workspace.expenses.removeConfirmTitle')}
        description={t('workspace.expenses.removeConfirmDescription', { name })}
        confirmLabel={tCommon('remove')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

function EditExpenseDialog({
  expense,
  open,
  onOpenChange,
}: {
  expense: ExpenseDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [type, setType] = React.useState<ExpenseType>(expense.type);
  const [label, setLabel] = React.useState(expense.label ?? '');
  const [amount, setAmount] = React.useState(String(expense.amount));
  const [paymentStatus, setPaymentStatus] = React.useState<PaymentStatus>(expense.paymentStatus);
  const [incurredAt, setIncurredAt] = React.useState(toDateInputValue(expense.incurredAt));
  const [notes, setNotes] = React.useState(expense.notes ?? '');

  React.useEffect(() => {
    if (open) {
      setType(expense.type);
      setLabel(expense.label ?? '');
      setAmount(String(expense.amount));
      setPaymentStatus(expense.paymentStatus);
      setIncurredAt(toDateInputValue(expense.incurredAt));
      setNotes(expense.notes ?? '');
    }
  }, [open, expense]);

  const save = useMutation({
    mutationFn: () => {
      const parsed = Number(amount);
      if (!amount.trim() || !Number.isFinite(parsed) || parsed < 0) {
        throw new Error(t('workspace.expenses.invalidAmount'));
      }
      return api.expenses.update(expense.id, {
        type,
        label: label.trim() || null,
        amount: parsed,
        paymentStatus,
        incurredAt: incurredAt ? new Date(incurredAt) : null,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success(t('workspace.expenses.updatedToast'));
      queryClient.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('workspace.expenses.editDialogTitle')}</DialogTitle>
          <DialogDescription>{t('workspace.expenses.editDialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t('fields.type')}>
            <Select value={type} onValueChange={(v) => setType(v as ExpenseType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_TYPES.map((et) => (
                  <SelectItem key={et} value={et}>
                    {enumLabel(tEnums, 'expenseType', et)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('workspace.expenses.labelField')} hint={t('fields.optionalHint')}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('workspace.expenses.labelPlaceholder')} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('workspace.expenses.amountLabel')}>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </Field>
            <Field label={t('workspace.expenses.incurredOnLabel')} hint={t('fields.optionalHint')}>
              <Input type="date" value={incurredAt} onChange={(e) => setIncurredAt(e.target.value)} />
            </Field>
          </div>
          <Field label={t('fields.paymentStatus')}>
            <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as PaymentStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {enumLabel(tEnums, 'paymentStatus', s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('fields.notes')} hint={t('fields.optionalHint')}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={!amount.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? tCommon('saving') : t('workspace.saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddExpenseForm({
  campaignId,
  currency,
  influencers,
}: {
  campaignId: string;
  currency: string;
  influencers: CampaignInfluencerDTO[];
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [type, setType] = React.useState<ExpenseType>('OTHER');
  const [label, setLabel] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [paymentStatus, setPaymentStatus] = React.useState<PaymentStatus>('UNPAID');
  const [incurredAt, setIncurredAt] = React.useState('');
  const [campaignInfluencerId, setCampaignInfluencerId] = React.useState(NONE);
  const [notes, setNotes] = React.useState('');

  const addExpense = useMutation({
    mutationFn: () => {
      const parsed = Number(amount);
      if (!amount.trim() || !Number.isFinite(parsed) || parsed < 0) {
        throw new Error(t('workspace.expenses.invalidAmount'));
      }
      return api.campaigns.addExpense(campaignId, {
        type,
        label: label.trim() || undefined,
        amount: parsed,
        currency,
        paymentStatus,
        incurredAt: incurredAt ? new Date(incurredAt) : undefined,
        notes: notes.trim() || undefined,
        campaignInfluencerId: campaignInfluencerId === NONE ? undefined : campaignInfluencerId,
      });
    },
    onSuccess: () => {
      toast.success(t('workspace.expenses.addedToast'));
      setType('OTHER');
      setLabel('');
      setAmount('');
      setPaymentStatus('UNPAID');
      setIncurredAt('');
      setCampaignInfluencerId(NONE);
      setNotes('');
      queryClient.invalidateQueries();
      router.refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>{t('workspace.expenses.addExpenseTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label={t('fields.type')}>
          <Select value={type} onValueChange={(v) => setType(v as ExpenseType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_TYPES.map((et) => (
                <SelectItem key={et} value={et}>
                  {enumLabel(tEnums, 'expenseType', et)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('workspace.expenses.labelField')} hint={t('fields.optionalHint')}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('workspace.expenses.labelPlaceholder')} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('workspace.expenses.amountLabel')}>
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label={t('workspace.expenses.incurredOnLabel')} hint={t('fields.optionalHint')}>
            <Input type="date" value={incurredAt} onChange={(e) => setIncurredAt(e.target.value)} />
          </Field>
        </div>
        <Field label={t('fields.paymentStatus')}>
          <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as PaymentStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {enumLabel(tEnums, 'paymentStatus', s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {influencers.length > 0 ? (
          <Field label={t('workspace.expenses.attributedInfluencerLabel')} hint={t('fields.optionalHint')}>
            <Select value={campaignInfluencerId} onValueChange={setCampaignInfluencerId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('workspace.expenses.noneOption')}</SelectItem>
                {influencers.map((ci) => (
                  <SelectItem key={ci.id} value={ci.id}>
                    <BidiText>{ci.influencer.displayName}</BidiText>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <Field label={t('fields.notes')} hint={t('fields.optionalHint')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </CardContent>
      <CardFooter>
        <Button className="w-full" disabled={!amount.trim() || addExpense.isPending} onClick={() => addExpense.mutate()}>
          {addExpense.isPending ? t('workspace.expenses.adding') : t('workspace.expenses.addExpenseTitle')}
        </Button>
      </CardFooter>
    </Card>
  );
}

function CostsTab({
  campaignId,
  currency,
  influencers,
  costs,
}: {
  campaignId: string;
  currency: string;
  influencers: CampaignInfluencerDTO[];
  costs: { expenses: ExpenseDTO[]; summary: CostSummaryDTO };
}) {
  const t = useTranslations('campaigns');
  const s = costs.summary;
  const overspent = (s.budgetUsedPercent ?? 0) > 100;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={t('fields.plannedBudget')}
          value={s.plannedBudget}
          icon={Target}
          tone="neutral"
          format={(n) => formatCurrency(n, s.currency)}
        />
        <StatCard
          label={t('workspace.expenses.totalSpend')}
          value={s.totalSpend}
          icon={Wallet}
          tone={overspent ? 'danger' : 'warning'}
          format={(n) => formatCurrency(n, s.currency)}
          hint={
            s.budgetUsedPercent != null
              ? t('workspace.expenses.percentOfBudget', { percent: formatPercent(s.budgetUsedPercent, 0) })
              : undefined
          }
        />
        <StatCard
          label={t('workspace.expenses.influencerFees')}
          value={s.influencerFees}
          icon={Coins}
          tone="info"
          format={(n) => formatCurrency(n, s.currency)}
        />
        <StatCard
          label={t('workspace.expenses.giftValueLabel')}
          value={s.giftValue}
          icon={Package}
          tone="accent"
          format={(n) => formatCurrency(n, s.currency)}
        />
        <StatCard
          label={t('workspace.expenses.otherExpenses')}
          value={s.otherExpenses}
          icon={Receipt}
          tone="neutral"
          format={(n) => formatCurrency(n, s.currency)}
        />
        <StatCard
          label={t('workspace.expenses.paidLabel')}
          value={s.paid}
          icon={CheckCircle2}
          tone="success"
          format={(n) => formatCurrency(n, s.currency)}
        />
        <StatCard
          label={t('workspace.expenses.unpaidLabel')}
          value={s.unpaid}
          icon={AlertCircle}
          tone="danger"
          format={(n) => formatCurrency(n, s.currency)}
        />
      </div>

      {s.plannedBudget != null ? (
        <Card>
          <CardContent className="p-5">
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">{t('workspace.expenses.budgetUtilization')}</span>
              <span className="text-muted-foreground">{formatPercent(s.budgetUsedPercent, 0)}</span>
            </div>
            <ProgressBar value={s.budgetUsedPercent ?? 0} tone={overspent ? 'danger' : 'primary'} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('workspace.expenses.expensesTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {costs.expenses.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title={t('workspace.expenses.emptyTitle')}
                description={t('workspace.expenses.emptyDescription')}
                className="border-0"
              />
            ) : (
              <div className="divide-y divide-border">
                {costs.expenses.map((e) => (
                  <ExpenseRow key={e.id} expense={e} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <AddExpenseForm campaignId={campaignId} currency={currency} influencers={influencers} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

function MetricTile({
  label,
  value,
  icon: Icon,
  tooltip,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tooltip: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground">
            {label} <InfoTooltip text={tooltip} />
          </span>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted-foreground">
            <Icon className="size-5" />
          </span>
        </div>
        <div className="text-3xl font-semibold tracking-tight text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Metric freshness + provenance banner (W6-1). Surfaces when the campaign's
 * metrics were last synced, whether they are stale, coverage, and where the
 * numbers came from — so an exec reads the efficiency figures with the right
 * amount of trust.
 */
function MetricsFreshnessBanner({ efficiency }: { efficiency: CampaignEfficiencyDTO }) {
  const t = useTranslations('campaigns');
  const tEnums = useTranslations('enums');
  const { relativeTime } = useLocalizedFormat();
  const synced = efficiency.metricsLastSyncedAt;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border bg-surface-muted/40 px-4 py-3 text-sm">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Clock className="size-4" />
        {synced
          ? t('workspace.performance.metricsSynced', { relative: relativeTime(synced) })
          : t('workspace.performance.metricsNeverSynced')}
      </span>
      <Badge tone={efficiency.isStale ? 'warning' : 'success'}>
        {efficiency.isStale ? (
          <span className="inline-flex items-center gap-1">
            <AlertCircle className="size-3.5" />{' '}
            {t('workspace.performance.staleLabel', { days: efficiency.freshnessWindowDays })}
          </span>
        ) : (
          t('workspace.performance.freshLabel')
        )}
      </Badge>
      <span className="text-muted-foreground">
        {t('workspace.performance.measuredCount', {
          measured: efficiency.contentWithMetrics,
          total: efficiency.contentCount,
        })}
      </span>
      {efficiency.sources.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {efficiency.sources.map((s) => (
            <Badge key={s.source} tone="neutral">
              {enumLabel(tEnums, 'dataSource', s.source)} · {s.count}
            </Badge>
          ))}
        </span>
      )}
    </div>
  );
}

function PerformanceTab({ campaignId }: { campaignId: string }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tContent = useTranslations('content');
  const { relativeTime } = useLocalizedFormat();
  // Efficiency (CPV/CPM/CPE + rollups + freshness) is computed server-side
  // (W6-1 / ARCH-01) — the browser renders these numbers, it never derives them.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-efficiency', campaignId],
    queryFn: () => api.campaigns.efficiency(campaignId),
  });
  // Every post in the campaign, a page at a time (the totals above cover them all).
  const [tablePage, setTablePage] = React.useState(1);
  const rowsQuery = useQuery({
    queryKey: ['campaign-content', campaignId, 'performance', tablePage],
    queryFn: () => api.campaigns.content(campaignId, { bucket: 'linked', page: tablePage, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-14 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={TrendingUp}
        title={t('workspace.performance.loadErrorTitle')}
        description={t('workspace.performance.loadErrorDescription')}
      />
    );
  }

  if (data.contentCount === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title={t('workspace.performance.emptyTitle')}
        description={t('workspace.performance.emptyDescription')}
      />
    );
  }

  const { currency } = data;
  const byContent = new Map(data.perContent.map((p) => [p.contentId, p]));

  return (
    <div className="space-y-6">
      <MetricsFreshnessBanner efficiency={data} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label={t('workspace.performance.totalViews')} value={data.totalViews} icon={Eye} tone="info" format={formatCompact} />
        <StatCard
          label={t('workspace.performance.totalEngagement')}
          value={data.totalEngagement}
          icon={Heart}
          tone="accent"
          format={formatCompact}
        />
        <MetricTile
          label={t('workspace.performance.avgEngagementRate')}
          value={<LtrText>{data.avgEngagementRate != null ? formatPercent(data.avgEngagementRate) : tCommon('na')}</LtrText>}
          icon={PercentIcon}
          tooltip={t('workspace.performance.avgEngagementRateTooltip')}
        />
        <MetricTile
          label={t('workspace.performance.costPerContent')}
          value={<LtrText>{data.costPerContent != null ? formatCurrency(data.costPerContent, currency) : tCommon('na')}</LtrText>}
          icon={DollarSign}
          tooltip={t('workspace.performance.costPerContentTooltip')}
        />
        <MetricTile
          label={t('workspace.performance.cpvLabel')}
          value={<LtrText>{data.costPerView != null ? formatCurrency(data.costPerView, currency) : tCommon('na')}</LtrText>}
          icon={Eye}
          tooltip={t('workspace.performance.cpvTooltip')}
        />
        <MetricTile
          label={t('workspace.performance.cpmLabel')}
          value={<LtrText>{data.costPerMille != null ? formatCurrency(data.costPerMille, currency) : tCommon('na')}</LtrText>}
          icon={TrendingUp}
          tooltip={t('workspace.performance.cpmTooltip')}
        />
        <MetricTile
          label={t('workspace.performance.cpeLabel')}
          value={<LtrText>{data.costPerEngagement != null ? formatCurrency(data.costPerEngagement, currency) : tCommon('na')}</LtrText>}
          icon={Heart}
          tooltip={t('workspace.performance.cpeTooltip')}
        />
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>{t('workspace.performance.contentPerformanceTitle')}</CardTitle>
          <BulkMetricsDialog campaignId={campaignId} />
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-start text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">{t('workspace.performance.contentHeader')}</th>
                <th className="px-5 py-3 font-medium">{t('fields.platform')}</th>
                <th className="px-5 py-3 font-medium">{t('workspace.performance.viewsHeader')}</th>
                <th className="px-5 py-3 font-medium">{t('workspace.performance.engagementHeader')}</th>
                <th className="px-5 py-3 font-medium">{t('workspace.performance.engRateHeader')}</th>
                <th className="px-5 py-3 font-medium">
                  <span className="inline-flex items-center gap-1">
                    {t('workspace.performance.estCpvHeader')}
                    <InfoTooltip text={t('workspace.performance.estCpvTooltip')} />
                  </span>
                </th>
                <th className="px-3 py-3" aria-label={tCommon('actions')} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(rowsQuery.data?.data ?? []).map((c) => {
                const eff = byContent.get(c.id);
                return (
                  <tr key={c.id}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={c.influencer?.displayName ?? tCommon('unknown')} src={c.influencer?.avatarUrl} size="xs" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {c.influencer?.displayName ? (
                              <BidiText>{c.influencer.displayName}</BidiText>
                            ) : (
                              tCommon('unassigned')
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{relativeTime(c.publishedAt ?? c.detectedAt)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <PlatformBadge platform={c.platform} size="sm" />
                    </td>
                    <td className="px-5 py-3 tabular-nums"><LtrText>{eff?.views != null ? formatCompact(eff.views) : tCommon('na')}</LtrText></td>
                    <td className="px-5 py-3 tabular-nums">
                      <LtrText>{eff?.totalEngagement != null ? formatCompact(eff.totalEngagement) : tCommon('na')}</LtrText>
                    </td>
                    <td className="px-5 py-3 tabular-nums">
                      <LtrText>{eff?.engagementRate != null ? formatPercent(eff.engagementRate) : tCommon('na')}</LtrText>
                    </td>
                    <td className="px-5 py-3 tabular-nums">
                      <LtrText>{eff?.costPerView != null ? formatCurrency(eff.costPerView, currency) : tCommon('na')}</LtrText>
                    </td>
                    <td className="px-3 py-3 text-end">
                      <EnterMetricsDialog
                        content={c}
                        trigger={
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={tContent('metricsEntry.open')}>
                            <BarChart3 className="h-4 w-4" />
                          </Button>
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
        <PageFooter pagination={rowsQuery.data?.pagination} onPageChange={setTablePage} className="px-5 pb-4" />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

function ActivityTab({ campaignId }: { campaignId: string }) {
  const t = useTranslations('campaigns');
  return (
    <ActivityFeed
      filter={{ campaignId }}
      queryKey={['campaign-activity', campaignId]}
      emptyDescription={t('workspace.activity.emptyDescription')}
    />
  );
}
