'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Film, Link2, Megaphone, Paperclip, Pencil, Plus, Search, Trash2, Users, Wallet } from 'lucide-react';
import type {
  CampaignDetailDTO,
  CampaignInfluencerDTO,
  CampaignInfluencerResultsDTO,
  CampaignOperationsRowDTO,
  DealType,
  ParticipationStatus,
} from '@influenceos/contracts';
import { DEAL_TYPES, PARTICIPATION_STATUSES } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { DealTypeBadge, PaymentStatusBadge } from '@/components/ui/status-badges';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { OPERATIONS_FILTER_KEYS, StageStrip } from './operations-board-tab';
import { formatCompact, formatCurrency, formatPercent } from '@/lib/format';
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
import { useApp } from '@/components/shell/app-context';
import { PaymentHistory } from '@/components/finance/payment-history';
import { WhatsAppDialog } from '@/components/influencers/whatsapp-dialog';
import { AddInfluencerDialog } from './add-influencer-dialog';
import { BulkAddInfluencersDialog } from './bulk-add-influencers-dialog';
import { errorMessage } from '@/lib/errors';
import { toDateInputValue } from './workspace-shared';
import { DeliverableDialog, DeliverableRow } from './deliverables-tab';

// ---------------------------------------------------------------------------
// Influencers
// ---------------------------------------------------------------------------

type RosterFilter = CampaignOperationsRowDTO['filterBuckets'][number] | 'ALL';

export function InfluencersTab({ campaign, influencers }: { campaign: CampaignDetailDTO; influencers: CampaignInfluencerDTO[] }) {
  const t = useTranslations('campaigns');
  const [addDeliverableFor, setAddDeliverableFor] = React.useState<CampaignInfluencerDTO | null>(null);
  const [filter, setFilter] = React.useState<RosterFilter>('ALL');
  const [search, setSearch] = React.useState('');

  // Each row's 8 stages come from the Operations Board, so the roster and the
  // board always agree on where every creator is.
  const board = useQuery({
    queryKey: ['campaign-operations-board', campaign.id],
    queryFn: () => api.campaigns.operationsBoard(campaign.id),
    enabled: influencers.length > 0,
  });
  const opsById = React.useMemo(
    () => new Map((board.data?.rows ?? []).map((r) => [r.campaignInfluencerId, r])),
    [board.data],
  );

  const needle = search.trim().toLowerCase().replace(/^@/, '');
  const visible = influencers.filter((ci) => {
    if (filter !== 'ALL' && !opsById.get(ci.id)?.filterBuckets.includes(filter)) return false;
    if (!needle) return true;
    return (
      ci.influencer.displayName.toLowerCase().includes(needle) ||
      (ci.influencer.primaryUsername ?? '').toLowerCase().includes(needle)
    );
  });
  const chips = OPERATIONS_FILTER_KEYS.map((key) => ({
    key,
    count: influencers.filter((ci) => opsById.get(ci.id)?.filterBuckets.includes(key)).length,
  })).filter((c) => c.count > 0);

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

      {influencers.length > 1 ? (
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative lg:w-64 lg:shrink-0">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('workspace.influencers.searchPlaceholder')}
              aria-label={t('workspace.influencers.searchPlaceholder')}
              className="ps-9"
            />
          </div>
          {chips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <Button variant={filter === 'ALL' ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter('ALL')}>
                {t('operations.chipWithCount', { label: t('operations.allChip'), count: influencers.length })}
              </Button>
              {chips.map((c) => (
                <Button
                  key={c.key}
                  variant={filter === c.key ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setFilter(filter === c.key ? 'ALL' : c.key)}
                >
                  {t('operations.chipWithCount', { label: t(`operations.filters.${c.key}`), count: c.count })}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {influencers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('workspace.influencers.emptyTitle')}
          description={t('workspace.influencers.emptyDescription')}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t('workspace.influencers.noMatchesTitle')}
          description={t('workspace.influencers.noMatchesDescription')}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFilter('ALL');
                setSearch('');
              }}
            >
              {t('workspace.influencers.showEveryone')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {visible.map((ci) => (
            <InfluencerRow
              key={ci.id}
              ci={ci}
              campaign={campaign}
              ops={opsById.get(ci.id) ?? null}
              onAddDeliverable={() => setAddDeliverableFor(ci)}
            />
          ))}
        </div>
      )}

      <DeliverableDialog
        campaignInfluencer={addDeliverableFor}
        open={addDeliverableFor != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setAddDeliverableFor(null);
        }}
      />
    </div>
  );
}

/**
 * What one creator has delivered on this campaign and what it cost: posts up
 * vs planned, their latest views and engagements, and their own spend over
 * those — so the expensive creator's cost per view isn't averaged away.
 */
function RosterResults({ results, currency }: { results: CampaignInfluencerResultsDTO; currency: string }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const r = results;
  const na = tCommon('na');
  // "1 of 2" is a sentence and follows the page's direction; money and counts stay left-to-right.
  const items: { label: string; value: React.ReactNode; hint?: string | null; sentence?: boolean }[] = [
    {
      label: t('workspace.influencers.results.posts'),
      sentence: true,
      value:
        r.postsPlanned > 0
          ? t('workspace.influencers.results.postsOfPlanned', { live: r.postsLive, planned: r.postsPlanned })
          : String(r.postsLive),
      hint:
        r.postsTotal > r.postsLive
          ? t('workspace.influencers.results.postsDown', { count: r.postsTotal - r.postsLive })
          : null,
    },
    { label: t('workspace.influencers.results.views'), value: r.views != null ? formatCompact(r.views) : na },
    {
      label: t('workspace.influencers.results.engagements'),
      value: r.engagements != null ? formatCompact(r.engagements) : na,
      hint:
        r.engagementRate != null
          ? t('workspace.influencers.results.engagementRate', { rate: formatPercent(r.engagementRate) })
          : null,
    },
    { label: t('workspace.influencers.results.spend'), value: formatCurrency(r.spend, currency) },
    {
      label: t('workspace.influencers.results.costPerView'),
      value: r.costPerView != null ? formatCurrency(r.costPerView, currency) : na,
    },
    {
      label: t('workspace.influencers.results.costPerEngagement'),
      value: r.costPerEngagement != null ? formatCurrency(r.costPerEngagement, currency) : na,
    },
  ];
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="truncate text-xs text-muted-foreground">{item.label}</dt>
            <dd className="text-sm font-semibold tabular-nums text-foreground">
              {item.sentence ? item.value : <LtrText>{item.value}</LtrText>}
            </dd>
            {item.hint ? <dd className="truncate text-xs text-muted-foreground">{item.hint}</dd> : null}
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        {r.postsTotal === 0
          ? t('workspace.influencers.results.noPostsYet')
          : r.postsWithMetrics < r.postsTotal
            ? t('workspace.influencers.results.numbersOn', { measured: r.postsWithMetrics, total: r.postsTotal })
            : t('workspace.influencers.results.spendNote')}
      </p>
    </div>
  );
}

function InfluencerRow({
  ci,
  campaign,
  ops,
  onAddDeliverable,
}: {
  ci: CampaignInfluencerDTO;
  campaign: CampaignDetailDTO;
  ops: CampaignOperationsRowDTO | null;
  onAddDeliverable: () => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const queryClient = useQueryClient();
  const dp = ci.deliverableProgress;
  const [editOpen, setEditOpen] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [filesOpen, setFilesOpen] = React.useState(false);

  const remove = useMutation({
    mutationFn: () => api.campaignInfluencers.remove(ci.id),
    onSuccess: () => {
      toast.success(t('workspace.influencers.removedToast'));
      queryClient.invalidateQueries();
      setRemoveOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  // One click for the common case — what is still owed on the fee, paid in
  // full today by bank transfer — recorded in the payment ledger, with an
  // Undo that voids that payment again.
  const { can } = useApp();
  const owed = Math.max(0, (ci.agreedCost ?? 0) - (ci.paidAmount ?? 0));
  const canMarkPaid =
    can('FINANCE_MANAGE') &&
    (ci.dealType === 'PAID' || ci.dealType === 'PAID_PLUS_GIFTED') &&
    ci.agreedCost != null &&
    ci.agreedCost > 0 &&
    owed > 0.0005 &&
    ci.paymentStatus !== 'PAID' &&
    ci.paymentStatus !== 'NOT_APPLICABLE';
  const refresh = () => {
    queryClient.invalidateQueries();
  };
  const markPaid = useMutation({
    mutationFn: () => api.finance.payFee(ci.id, { amount: owed, paidAt: new Date(), method: 'BANK_TRANSFER' }),
    onSuccess: (payment) => {
      refresh();
      toast.success(t('workspace.influencers.markedPaidToast', { name: ci.influencer.displayName }), {
        action: {
          label: t('workspace.influencers.undo'),
          onClick: () => {
            api.finance
              .voidPayment(payment.id, t('workspace.influencers.undoPaymentReason'))
              .then(refresh)
              .catch((e: unknown) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))));
          },
        },
      });
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
              aria-label={t('workspace.influencers.filesAriaLabel', { name: ci.influencer.displayName })}
              title={t('workspace.influencers.filesAriaLabel', { name: ci.influencer.displayName })}
              onClick={() => setFilesOpen(true)}
            >
              <Paperclip className="h-4 w-4" />
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
          {canMarkPaid ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              disabled={markPaid.isPending}
              onClick={() => markPaid.mutate()}
            >
              {markPaid.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
              {t('workspace.influencers.markPaid')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-4 border-t border-border px-5 py-4">
        {ops ? <StageStrip stages={ops.stages} /> : null}
        <RosterResults results={ci.results} currency={campaign.currency} />
      </div>

      <EditInfluencerDialog ci={ci} currency={ci.currency ?? campaign.currency} open={editOpen} onOpenChange={setEditOpen} />
      <LinkExistingContentDialog ci={ci} campaign={campaign} open={linkOpen} onOpenChange={setLinkOpen} />
      <Dialog open={filesOpen} onOpenChange={setFilesOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('workspace.influencers.filesTitle', { name: ci.influencer.displayName })}</DialogTitle>
            <DialogDescription>{t('workspace.influencers.filesDescription')}</DialogDescription>
          </DialogHeader>
          {filesOpen ? <AttachmentsPanel target={{ campaignInfluencerId: ci.id }} compact /> : null}
        </DialogContent>
      </Dialog>
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
  currency,
  open,
  onOpenChange,
}: {
  ci: CampaignInfluencerDTO;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const queryClient = useQueryClient();
  const [dealType, setDealType] = React.useState<DealType>(ci.dealType);
  const [agreedCost, setAgreedCost] = React.useState(ci.agreedCost != null ? String(ci.agreedCost) : '');
  const [giftedProductValue, setGiftedProductValue] = React.useState(
    ci.giftedProductValue != null ? String(ci.giftedProductValue) : '',
  );
  const [participationStatus, setParticipationStatus] = React.useState<ParticipationStatus>(ci.participationStatus);
  const [dateContacted, setDateContacted] = React.useState(toDateInputValue(ci.dateContacted));
  const [expectedPublishAt, setExpectedPublishAt] = React.useState(toDateInputValue(ci.expectedPublishAt));
  const [notes, setNotes] = React.useState(ci.notes ?? '');

  React.useEffect(() => {
    if (open) {
      setDealType(ci.dealType);
      setAgreedCost(ci.agreedCost != null ? String(ci.agreedCost) : '');
      setGiftedProductValue(ci.giftedProductValue != null ? String(ci.giftedProductValue) : '');
      setParticipationStatus(ci.participationStatus);
      setDateContacted(toDateInputValue(ci.dateContacted));
      setExpectedPublishAt(toDateInputValue(ci.expectedPublishAt));
      setNotes(ci.notes ?? '');
    }
  }, [open, ci]);

  // Payments are recorded in the payment history below (P2.3), not typed
  // in as a status — only people who may see money see it.
  const { can } = useApp();
  const showPayments =
    can('FINANCE_VIEW') &&
    (ci.paymentStatus === 'PAID' ||
      ci.paymentStatus === 'PARTIALLY_PAID' ||
      ((ci.dealType === 'PAID' || ci.dealType === 'PAID_PLUS_GIFTED') && (ci.agreedCost ?? 0) > 0));
  const day = (v: string) => (v ? new Date(`${v}T12:00:00`) : null);

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
        dateContacted: day(dateContacted),
        expectedPublishAt: day(expectedPublishAt),
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success(t('workspace.influencers.updatedToast'));
      queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
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
          <Field label={t('workspace.influencers.dateContactedLabel')} hint={t('fields.optionalHint')}>
            <Input type="date" value={dateContacted} onChange={(e) => setDateContacted(e.target.value)} />
          </Field>
          <Field label={t('workspace.influencers.expectedPublishLabel')} hint={t('fields.optionalHint')}>
            <Input type="date" value={expectedPublishAt} onChange={(e) => setExpectedPublishAt(e.target.value)} />
          </Field>
          <Field label={t('fields.notes')} hint={t('fields.optionalHint')} className="col-span-2">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
        </div>

        {showPayments ? (
          <div className="border-t border-border pt-4">
            <PaymentHistory
              target={{ kind: 'FEE', id: ci.id }}
              payeeName={ci.influencer.displayName}
              amount={ci.agreedCost ?? 0}
              owed={Math.max(0, (ci.agreedCost ?? 0) - (ci.paidAmount ?? 0))}
              currency={currency}
              receiptTarget={{ campaignInfluencerId: ci.id }}
              onChanged={() => {
                queryClient.invalidateQueries();
              }}
            />
          </div>
        ) : null}

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
