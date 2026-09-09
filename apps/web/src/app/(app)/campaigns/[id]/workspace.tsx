'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity as ActivityIcon,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  DollarSign,
  Eye,
  FileText,
  Heart,
  ListChecks,
  Package,
  Percent as PercentIcon,
  Plus,
  Receipt,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import type {
  CampaignDetailDTO,
  CampaignInfluencerDTO,
  CostSummaryDTO,
  DeliverableDTO,
  DeliverableStatus,
  DeliverableType,
  ExpenseDTO,
  ExpenseType,
  PaymentStatus,
  Platform,
  PublishedContentDTO,
  ScriptDTO,
} from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import {
  CAMPAIGN_OBJECTIVE_LABELS,
  DELIVERABLE_STATUSES,
  DELIVERABLE_STATUS_LABELS,
  DELIVERABLE_TYPES,
  DELIVERABLE_TYPE_LABELS,
  EXPENSE_TYPES,
  EXPENSE_TYPE_LABELS,
  PARTICIPATION_STATUS_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  PLATFORM_META,
  PLATFORMS,
} from '@influenceos/shared';
import { api } from '@/lib/api-browser';
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
import { StatCard } from '@/components/ui/stat-card';
import { ProgressBar } from '@/components/ui/progress';
import { InfoTooltip } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { ContentGrid } from '@/components/content/content-grid';
import { formatCompact, formatCurrency, formatPercent, relativeTime, shortDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AttachmentsPanel } from '@/components/common/attachments-panel';
import { AddInfluencerDialog } from './add-influencer-dialog';

/** Sentinel for "no influencer attributed" in the expense form's Select (Radix forbids an empty-string value). */
const NONE = 'none';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.';
}

export interface WorkspaceProps {
  campaign: CampaignDetailDTO;
  influencers: CampaignInfluencerDTO[];
  costs: { expenses: ExpenseDTO[]; summary: CostSummaryDTO };
  scripts: ScriptDTO[];
  contentFeed: PublishedContentDTO[];
}

/** The campaign control room — tabs covering everything about one campaign. */
export function Workspace({ campaign, influencers, costs, scripts, contentFeed }: WorkspaceProps) {
  return (
    <Tabs defaultValue="overview">
      <TabsList className="flex-wrap">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="influencers">Influencers</TabsTrigger>
        <TabsTrigger value="deliverables">Deliverables</TabsTrigger>
        <TabsTrigger value="scripts">Scripts</TabsTrigger>
        <TabsTrigger value="content">Live Content</TabsTrigger>
        <TabsTrigger value="costs">Costs</TabsTrigger>
        <TabsTrigger value="performance">Performance</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <OverviewTab campaign={campaign} />
      </TabsContent>

      <TabsContent value="influencers">
        <InfluencersTab campaignId={campaign.id} influencers={influencers} />
      </TabsContent>

      <TabsContent value="deliverables">
        <DeliverablesTab influencers={influencers} />
      </TabsContent>

      <TabsContent value="scripts">
        <ScriptsTab scripts={scripts} />
      </TabsContent>

      <TabsContent value="content">
        <ContentGrid
          items={contentFeed}
          emptyDescription="Published content for this campaign will show up here once influencers go live."
        />
      </TabsContent>

      <TabsContent value="costs">
        <CostsTab campaignId={campaign.id} currency={campaign.currency} influencers={influencers} costs={costs} />
      </TabsContent>

      <TabsContent value="performance">
        <PerformanceTab contentFeed={contentFeed} costs={costs.summary} />
      </TabsContent>

      <TabsContent value="files">
        <Card>
          <CardHeader>
            <CardTitle>Campaign files</CardTitle>
          </CardHeader>
          <CardContent>
            <AttachmentsPanel target={{ campaignId: campaign.id }} compact />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="activity">
        <ActivityTab campaignId={campaign.id} />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{value || '—'}</span>
    </div>
  );
}

function OverviewTab({ campaign }: { campaign: CampaignDetailDTO }) {
  const p = campaign.progress;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            {campaign.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{campaign.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No description on file yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Creative Brief</CardTitle>
          </CardHeader>
          <CardContent>
            {campaign.brief ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{campaign.brief}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No brief on file yet.</p>
            )}
          </CardContent>
        </Card>

        {campaign.internalNotes ? (
          <Card>
            <CardHeader>
              <CardTitle>Internal Notes</CardTitle>
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
            <CardTitle>Progress Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Deliverables published</span>
                <span className="font-medium text-foreground">
                  {p.deliverablesPublished}/{p.deliverablesTotal}
                </span>
              </div>
              <ProgressBar value={p.deliverableCompletion} tone="brand" className="mt-1.5" />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Influencers completed</span>
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
                  <span>Time elapsed</span>
                  <span className="font-medium text-foreground">{formatPercent(p.timeElapsedPercent, 0)}</span>
                </div>
                <ProgressBar value={p.timeElapsedPercent} tone="warning" className="mt-1.5" />
              </div>
            ) : null}
            {p.plannedBudget != null ? (
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Budget used</span>
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
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DetailRow label="Objective" value={campaign.objective ? CAMPAIGN_OBJECTIVE_LABELS[campaign.objective] : null} />
            <DetailRow label="Target market" value={campaign.targetMarket} />
            <DetailRow label="Owner" value={campaign.owner?.name} />
            <DetailRow label="Currency" value={campaign.currency} />
            <DetailRow label="Created" value={shortDate(campaign.createdAt)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Influencers
// ---------------------------------------------------------------------------

function InfluencersTab({ campaignId, influencers }: { campaignId: string; influencers: CampaignInfluencerDTO[] }) {
  const [addDeliverableFor, setAddDeliverableFor] = React.useState<CampaignInfluencerDTO | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {influencers.length} influencer{influencers.length === 1 ? '' : 's'} on this campaign
        </p>
        <AddInfluencerDialog campaignId={campaignId} existingInfluencerIds={influencers.map((ci) => ci.influencer.id)} />
      </div>

      {influencers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No influencers yet"
          description="Add creators to this campaign to start tracking deliverables, payments and content."
        />
      ) : (
        <div className="space-y-4">
          {influencers.map((ci) => (
            <InfluencerRow key={ci.id} ci={ci} onAddDeliverable={() => setAddDeliverableFor(ci)} />
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

function InfluencerRow({ ci, onAddDeliverable }: { ci: CampaignInfluencerDTO; onAddDeliverable: () => void }) {
  const dp = ci.deliverableProgress;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={ci.influencer.displayName} src={ci.influencer.avatarUrl} size="lg" rounded="lg" />
          <div className="min-w-0">
            <Link href={`/influencers/${ci.influencer.id}`} className="truncate font-semibold hover:underline">
              {ci.influencer.displayName}
            </Link>
            {ci.influencer.primaryUsername ? (
              <p className="truncate text-sm text-muted-foreground">@{ci.influencer.primaryUsername}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <DealTypeBadge status={ci.dealType} />
              <PaymentStatusBadge status={ci.paymentStatus} />
              <Badge tone="neutral">{PARTICIPATION_STATUS_LABELS[ci.participationStatus]}</Badge>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <p className="text-lg font-semibold text-foreground">
            {ci.agreedCost != null
              ? formatCurrency(ci.agreedCost, ci.currency ?? undefined)
              : ci.dealType === 'GIFTED_PRODUCT'
                ? 'Gifted'
                : '—'}
          </p>
          {ci.giftedProductValue != null ? (
            <p className="text-xs text-muted-foreground">
              + {formatCurrency(ci.giftedProductValue, ci.currency ?? undefined)} gift value
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {dp.published}/{dp.total} delivered
          </p>
        </div>
      </div>

      <div className="border-t border-border bg-surface-muted/40 p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deliverables</p>
          <Button type="button" variant="ghost" size="sm" onClick={onAddDeliverable}>
            <Plus className="h-3.5 w-3.5" /> Add deliverable
          </Button>
        </div>
        {ci.deliverables.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deliverables yet.</p>
        ) : (
          <div className="space-y-2">
            {ci.deliverables.map((d) => (
              <DeliverableRow key={d.id} deliverable={d} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Deliverables (shared row + flat cross-influencer tab)
// ---------------------------------------------------------------------------

const TERMINAL_DELIVERABLE_STATUSES: DeliverableStatus[] = ['PUBLISHED', 'VERIFIED', 'CANCELLED', 'MISSED'];

function DeliverableRow({
  deliverable,
  influencerName,
  influencerAvatar,
}: {
  deliverable: DeliverableDTO;
  influencerName?: string;
  influencerAvatar?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const updateStatus = useMutation({
    mutationFn: (status: DeliverableStatus) => api.deliverables.update(deliverable.id, { status }),
    onSuccess: () => {
      toast.success('Deliverable status updated');
      queryClient.invalidateQueries();
      router.refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const isOverdue =
    Boolean(deliverable.dueDate) &&
    new Date(deliverable.dueDate as string).getTime() < Date.now() &&
    !TERMINAL_DELIVERABLE_STATUSES.includes(deliverable.status);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      {influencerName ? (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={influencerName} src={influencerAvatar} size="xs" />
          <span className="truncate text-sm font-medium">{influencerName}</span>
        </div>
      ) : null}

      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        <PlatformIcon platform={deliverable.platform} className="h-4 w-4 text-muted-foreground" />
        {DELIVERABLE_TYPE_LABELS[deliverable.type]}
        {deliverable.quantity > 1 ? ` ×${deliverable.quantity}` : ''}
      </span>

      {deliverable.dueDate ? (
        <span className={cn('flex items-center gap-1 text-xs', isOverdue ? 'font-medium text-danger' : 'text-muted-foreground')}>
          <Clock className="h-3.5 w-3.5" /> Due {shortDate(deliverable.dueDate)}
        </span>
      ) : null}

      {deliverable.publishedUrl ? (
        <a href={deliverable.publishedUrl} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">
          View published
        </a>
      ) : null}

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
                {DELIVERABLE_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function DeliverablesTab({ influencers }: { influencers: CampaignInfluencerDTO[] }) {
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
        title="No deliverables yet"
        description="Deliverables assigned to influencers on this campaign will appear here."
      />
    );
  }

  return (
    <div className="space-y-2">
      {rows.map(({ ci, d }) => (
        <DeliverableRow key={d.id} deliverable={d} influencerName={ci.influencer.displayName} influencerAvatar={ci.influencer.avatarUrl} />
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const [platform, setPlatform] = React.useState<Platform>('INSTAGRAM');
  const [type, setType] = React.useState<DeliverableType>('POST');
  const [quantity, setQuantity] = React.useState('1');
  const [dueDate, setDueDate] = React.useState('');
  const [requirements, setRequirements] = React.useState('');

  React.useEffect(() => {
    if (campaignInfluencer) {
      setPlatform(campaignInfluencer.influencer.primaryPlatform ?? 'INSTAGRAM');
      setType('POST');
      setQuantity('1');
      setDueDate('');
      setRequirements('');
    }
  }, [campaignInfluencer]);

  const addDeliverable = useMutation({
    mutationFn: () => {
      if (!campaignInfluencer) throw new Error('No influencer selected.');
      return api.campaignInfluencers.addDeliverable(campaignInfluencer.id, {
        platform,
        type,
        quantity: Number(quantity) || 1,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        requirements: requirements.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Deliverable added');
      queryClient.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add deliverable</DialogTitle>
          <DialogDescription>
            {campaignInfluencer ? `For ${campaignInfluencer.influencer.displayName}` : 'Assign a new deliverable.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Platform">
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
          <Field label="Type">
            <Select value={type} onValueChange={(v) => setType(v as DeliverableType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIVERABLE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {DELIVERABLE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Quantity">
            <Input type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Due date" hint="Optional">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Requirements" hint="Optional" className="col-span-2">
            <Textarea
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="Hashtags, mentions, key messages…"
              rows={3}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={addDeliverable.isPending} onClick={() => addDeliverable.mutate()}>
            {addDeliverable.isPending ? 'Adding…' : 'Add deliverable'}
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

function ScriptsTab({ scripts }: { scripts: ScriptDTO[] }) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (scripts.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No scripts yet"
        description="Content scripts and creative guidelines for this campaign will appear here."
      />
    );
  }

  return (
    <div className="space-y-3">
      {scripts.map((script) => {
        const current = script.versions.find((v) => v.version === script.currentVersion) ?? script.versions[0];
        const isOpen = expanded.has(script.id);

        return (
          <Card key={script.id} className="overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(script.id)}
              className="flex w-full items-center justify-between gap-3 p-5 text-left transition-colors hover:bg-surface-muted"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <FileText className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{script.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Version {script.currentVersion} · Updated {relativeTime(script.updatedAt)}
                  </p>
                </div>
              </div>
              {isOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </button>

            {isOpen && current ? (
              <div className="space-y-4 border-t border-border p-5">
                {current.body ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Script</p>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{current.body}</p>
                  </div>
                ) : null}
                {current.captionSuggestion ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Caption suggestion
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{current.captionSuggestion}</p>
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <TagList label="Do's" items={current.dos} tone="success" />
                  <TagList label="Don'ts" items={current.donts} tone="danger" />
                  <TagList label="Talking points" items={current.talkingPoints} tone="info" />
                  <TagList label="Required claims" items={current.requiredClaims} tone="neutral" />
                  <TagList label="Hashtags" items={current.hashtags.map((h) => `#${h}`)} tone="accent" />
                  <TagList label="Mentions" items={current.mentions.map((m) => `@${m}`)} tone="accent" />
                </div>

                {current.referenceLinks.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Reference links
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
                          {link}
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                {current.internalComments ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Internal comments
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{current.internalComments}</p>
                  </div>
                ) : null}

                {current.createdByName ? (
                  <p className="text-xs text-muted-foreground">Written by {current.createdByName}</p>
                ) : null}
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

function ExpenseRow({ expense }: { expense: ExpenseDTO }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
        <Receipt className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{expense.label || EXPENSE_TYPE_LABELS[expense.type]}</p>
        <p className="text-xs text-muted-foreground">
          {EXPENSE_TYPE_LABELS[expense.type]} · {expense.incurredAt ? shortDate(expense.incurredAt) : 'No date'}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold text-foreground">{formatCurrency(expense.amount, expense.currency)}</span>
        <PaymentStatusBadge status={expense.paymentStatus} />
      </div>
    </div>
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
        throw new Error('Enter a valid amount.');
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
      toast.success('Expense added');
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
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Add expense</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Type">
          <Select value={type} onValueChange={(v) => setType(v as ExpenseType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {EXPENSE_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Label" hint="Optional">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Studio rental" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount">
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Incurred on" hint="Optional">
            <Input type="date" value={incurredAt} onChange={(e) => setIncurredAt(e.target.value)} />
          </Field>
        </div>
        <Field label="Payment status">
          <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as PaymentStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {PAYMENT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {influencers.length > 0 ? (
          <Field label="Attributed influencer" hint="Optional">
            <Select value={campaignInfluencerId} onValueChange={setCampaignInfluencerId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {influencers.map((ci) => (
                  <SelectItem key={ci.id} value={ci.id}>
                    {ci.influencer.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <Field label="Notes" hint="Optional">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </CardContent>
      <CardFooter>
        <Button className="w-full" disabled={!amount.trim() || addExpense.isPending} onClick={() => addExpense.mutate()}>
          {addExpense.isPending ? 'Adding…' : 'Add expense'}
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
  const s = costs.summary;
  const overspent = (s.budgetUsedPercent ?? 0) > 100;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Planned Budget" value={s.plannedBudget} icon={Target} tone="neutral" format={(n) => formatCurrency(n, s.currency)} />
        <StatCard
          label="Total Spend"
          value={s.totalSpend}
          icon={Wallet}
          tone={overspent ? 'danger' : 'warning'}
          format={(n) => formatCurrency(n, s.currency)}
          hint={s.budgetUsedPercent != null ? `${formatPercent(s.budgetUsedPercent, 0)} of budget` : undefined}
        />
        <StatCard label="Influencer Fees" value={s.influencerFees} icon={Coins} tone="info" format={(n) => formatCurrency(n, s.currency)} />
        <StatCard label="Gift Value" value={s.giftValue} icon={Package} tone="accent" format={(n) => formatCurrency(n, s.currency)} />
        <StatCard label="Other Expenses" value={s.otherExpenses} icon={Receipt} tone="neutral" format={(n) => formatCurrency(n, s.currency)} />
        <StatCard label="Paid" value={s.paid} icon={CheckCircle2} tone="success" format={(n) => formatCurrency(n, s.currency)} />
        <StatCard label="Unpaid" value={s.unpaid} icon={AlertCircle} tone="danger" format={(n) => formatCurrency(n, s.currency)} />
      </div>

      {s.plannedBudget != null ? (
        <Card>
          <CardContent className="p-5">
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">Budget utilization</span>
              <span className="text-muted-foreground">{formatPercent(s.budgetUsedPercent, 0)}</span>
            </div>
            <ProgressBar value={s.budgetUsedPercent ?? 0} tone={overspent ? 'danger' : 'primary'} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Expenses</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {costs.expenses.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No expenses logged"
                description="Add an expense to start tracking campaign costs."
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
  value: string;
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

function PerformanceTab({ contentFeed, costs }: { contentFeed: PublishedContentDTO[]; costs: CostSummaryDTO }) {
  const totals = React.useMemo(() => {
    let views = 0;
    let viewsKnown = false;
    let likes = 0;
    let comments = 0;
    let shares = 0;
    let saves = 0;
    let engagementSum = 0;
    let engagementCount = 0;

    for (const c of contentFeed) {
      const m = c.metrics;
      if (!m) continue;
      if (m.views != null) {
        views += m.views;
        viewsKnown = true;
      }
      if (m.likes != null) likes += m.likes;
      if (m.comments != null) comments += m.comments;
      if (m.shares != null) shares += m.shares;
      if (m.saves != null) saves += m.saves;
      if (m.engagementRate != null) {
        engagementSum += m.engagementRate;
        engagementCount += 1;
      }
    }

    const totalEngagement = likes + comments + shares + saves;
    const avgEngagementRate = engagementCount > 0 ? engagementSum / engagementCount : null;
    const cpv = viewsKnown && views > 0 ? costs.totalSpend / views : null;
    const cpm = cpv != null ? cpv * 1000 : null;
    const costPerContent = contentFeed.length > 0 ? costs.totalSpend / contentFeed.length : null;

    return { views: viewsKnown ? views : null, totalEngagement, avgEngagementRate, cpv, cpm, costPerContent };
  }, [contentFeed, costs.totalSpend]);

  if (contentFeed.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No performance data yet"
        description="Metrics appear once influencer content is published and synced."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Total Views" value={totals.views} icon={Eye} tone="info" format={formatCompact} />
        <StatCard label="Total Engagement" value={totals.totalEngagement} icon={Heart} tone="accent" format={formatCompact} />
        <MetricTile
          label="Avg. Engagement Rate"
          value={totals.avgEngagementRate != null ? formatPercent(totals.avgEngagementRate) : 'N/A'}
          icon={PercentIcon}
          tooltip="Average of each post's engagement rate — (likes + comments + shares) ÷ views."
        />
        <MetricTile
          label="Cost per Content"
          value={totals.costPerContent != null ? formatCurrency(totals.costPerContent, costs.currency) : 'N/A'}
          icon={DollarSign}
          tooltip="Total campaign spend ÷ number of published content pieces."
        />
        <MetricTile
          label="CPV"
          value={totals.cpv != null ? formatCurrency(totals.cpv, costs.currency) : 'N/A'}
          icon={Eye}
          tooltip="Cost Per View — total campaign spend ÷ total views across this campaign's content."
        />
        <MetricTile
          label="CPM"
          value={totals.cpm != null ? formatCurrency(totals.cpm, costs.currency) : 'N/A'}
          icon={TrendingUp}
          tooltip="Cost Per Mille — cost to reach 1,000 views (spend ÷ views × 1,000)."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Content Performance</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Content</th>
                <th className="px-5 py-3 font-medium">Platform</th>
                <th className="px-5 py-3 font-medium">Views</th>
                <th className="px-5 py-3 font-medium">Engagement</th>
                <th className="px-5 py-3 font-medium">Eng. rate</th>
                <th className="px-5 py-3 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Est. CPV
                    <InfoTooltip text="Cost per view, assuming total spend is split evenly across this campaign's published content." />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contentFeed.map((c) => {
                const m = c.metrics;
                const engagement = (m?.likes ?? 0) + (m?.comments ?? 0) + (m?.shares ?? 0) + (m?.saves ?? 0);
                const contentCpv = totals.costPerContent != null && m?.views ? totals.costPerContent / m.views : null;
                return (
                  <tr key={c.id}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={c.influencer?.displayName ?? 'Unknown'} src={c.influencer?.avatarUrl} size="xs" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{c.influencer?.displayName ?? 'Unassigned'}</p>
                          <p className="truncate text-xs text-muted-foreground">{relativeTime(c.publishedAt ?? c.detectedAt)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <PlatformBadge platform={c.platform} size="sm" />
                    </td>
                    <td className="px-5 py-3 tabular-nums">{m?.views != null ? formatCompact(m.views) : 'N/A'}</td>
                    <td className="px-5 py-3 tabular-nums">{formatCompact(engagement)}</td>
                    <td className="px-5 py-3 tabular-nums">{m?.engagementRate != null ? formatPercent(m.engagementRate) : 'N/A'}</td>
                    <td className="px-5 py-3 tabular-nums">
                      {contentCpv != null ? formatCurrency(contentCpv, costs.currency) : 'N/A'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

function ActivityTab({ campaignId }: { campaignId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-activity', campaignId],
    queryFn: () => api.activity.feed({ campaignId }),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title="Couldn't load activity"
        description="Something went wrong fetching the activity feed. Try again shortly."
      />
    );
  }

  const items = data?.data ?? [];
  if (items.length === 0) {
    return <EmptyState icon={ActivityIcon} title="No activity yet" description="Actions taken on this campaign will show up here." />;
  }

  return (
    <Card className="divide-y divide-border">
      {items.map((a) => (
        <div key={a.id} className="flex items-start gap-3 p-4">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
          <div className="min-w-0 flex-1">
            {a.link ? (
              <Link href={a.link} className="text-sm leading-snug hover:underline">
                {a.message}
              </Link>
            ) : (
              <p className="text-sm leading-snug">{a.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {a.actorName ? `${a.actorName} · ` : ''}
              {relativeTime(a.createdAt)}
            </p>
          </div>
        </div>
      ))}
    </Card>
  );
}
