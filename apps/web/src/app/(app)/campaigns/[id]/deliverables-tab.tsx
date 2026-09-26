'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Clock,
  FileText,
  ListChecks,
  MessageSquare,
  Package,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import type {
  AttachmentDTO,
  CampaignDetailDTO,
  CampaignInfluencerDTO,
  DeliverableDTO,
  DeliverableStatus,
  DeliverableType,
  InfluencerSummaryDTO,
  LogisticsRequestDTO,
  Platform,
  ProductShipmentDTO,
} from '@influenceos/contracts';
import {
  DELIVERABLE_STATUSES,
  DELIVERABLE_TYPES,
  PLATFORM_META,
  PLATFORMS,
  isDeliverableOutstanding,
  isDeliverableOverdue,
} from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { uploadAttachment } from '@/lib/upload';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText } from '@/components/common/bidi-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { DeliverableStatusBadge } from '@/components/ui/status-badges';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { AddContentFlow } from '@/components/content/add-content-flow';
import { CommentThread } from '@/components/collaboration/comment-thread';
import { useLocalizedFormat } from '@/lib/format';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { WhatsAppDialog } from '@/components/influencers/whatsapp-dialog';
import { ShipmentDetailSheet } from '@/app/(app)/logistics/shipment-detail-sheet';
import { errorMessage } from '@/lib/errors';
import { CampaignScriptsContext, NONE, splitList, toDateInputValue } from './workspace-shared';

// ---------------------------------------------------------------------------
// Deliverables (shared row + flat cross-influencer tab)
// ---------------------------------------------------------------------------

export function DeliverableRow({
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
  const queryClient = useQueryClient();
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [addContentOpen, setAddContentOpen] = React.useState(false);
  const [submitDraftOpen, setSubmitDraftOpen] = React.useState(false);
  const [commentsOpen, setCommentsOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const typeLabel = enumLabel(tEnums, 'deliverableType', deliverable.type);
  const scripts = React.useContext(CampaignScriptsContext);
  const script = deliverable.scriptReferenceId ? scripts.find((s) => s.id === deliverable.scriptReferenceId) : undefined;
  // UGC is always reviewed as a draft; other types when the campaign asks for it.
  const draftReview = deliverable.type === 'UGC' || campaign.draftReview;

  const updateStatus = useMutation({
    mutationFn: (status: DeliverableStatus) => api.deliverables.update(deliverable.id, { status }),
    onSuccess: () => {
      toast.success(t('workspace.deliverables.statusUpdatedToast'));
      queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const remove = useMutation({
    mutationFn: () => api.deliverables.remove(deliverable.id),
    onSuccess: () => {
      toast.success(t('workspace.deliverables.removedToast'));
      queryClient.invalidateQueries();
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

      {script ? (
        <Badge
          tone={script.approvedVersion != null ? 'success' : 'warning'}
          className="inline-flex max-w-[16rem] items-center gap-1"
          title={script.title}
        >
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {script.approvedVersion != null
              ? t('workspace.deliverables.scriptApproved', { version: script.approvedVersion })
              : t('workspace.deliverables.scriptNotApproved')}
          </span>
        </Badge>
      ) : null}

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
      {draftReview ? (
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
          aria-label={t('workspace.deliverables.editAriaLabel', { type: typeLabel })}
          onClick={() => setEditOpen(true)}
        >
          <Pencil className="h-4 w-4" />
        </Button>
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

      <DeliverableDialog campaignInfluencer={null} deliverable={deliverable} open={editOpen} onOpenChange={setEditOpen} />

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
              setAddContentOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <SubmitDraftDialog
        deliverableId={deliverable.id}
        deliverableType={deliverable.type}
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
 * A draft goes through DeliverableSubmission review, never PublishedContent:
 * the file itself (uploaded to the deliverable), the caption they plan to
 * post, a link, notes. Approving completes UGC; any other type is then
 * cleared to post and is delivered once the post is live.
 */
function SubmitDraftDialog({
  deliverableId,
  deliverableType,
  open,
  onOpenChange,
}: {
  deliverableId: string;
  deliverableType: DeliverableType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [assetUrl, setAssetUrl] = React.useState('');
  const [caption, setCaption] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [file, setFile] = React.useState<AttachmentDTO | null>(null);
  const [progress, setProgress] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (open) {
      setAssetUrl('');
      setCaption('');
      setNotes('');
      setFile(null);
      setProgress(null);
    }
  }, [open]);

  async function pick(chosen: File | undefined) {
    if (!chosen) return;
    setProgress(0);
    try {
      const uploaded = await uploadAttachment(chosen, { deliverableId }, setProgress);
      setFile(uploaded);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tCommon('somethingWentWrong'));
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function dropFile() {
    const current = file;
    setFile(null);
    // Not submitted: take the upload back off the deliverable.
    if (current) api.files.remove(current.id).catch(() => undefined);
  }

  const submit = useMutation({
    mutationFn: () =>
      api.deliverables.submit(deliverableId, {
        assetUrl: assetUrl.trim() || undefined,
        caption: caption.trim() || undefined,
        notes: notes.trim() || undefined,
        attachmentId: file?.id,
      }),
    onSuccess: () => {
      toast.success(t('workspace.deliverables.draftSubmittedToast'));
      queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const uploading = progress != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workspace.deliverables.submitDraftDialogTitle')}</DialogTitle>
          <DialogDescription>
            {deliverableType === 'UGC'
              ? t('workspace.deliverables.submitDraftDialogDescription')
              : t('workspace.deliverables.submitDraftDialogDescriptionPost')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t('workspace.deliverables.draftFileLabel')} hint={t('workspace.deliverables.draftFileHint')}>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="video/*,image/*,application/pdf"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            {file ? (
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  <BidiText>{file.fileName}</BidiText>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('workspace.deliverables.removeDraftFile')}
                  onClick={dropFile}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                {uploading
                  ? t('workspace.deliverables.uploadingDraft', { percent: Math.round((progress ?? 0) * 100) })
                  : t('workspace.deliverables.uploadDraft')}
              </Button>
            )}
          </Field>
          <Field label={t('workspace.deliverables.captionLabel')} hint={t('workspace.deliverables.captionHint')}>
            <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} dir="auto" />
          </Field>
          <Field label={t('workspace.deliverables.assetLinkLabel')} hint={t('workspace.deliverables.assetLinkHint')}>
            <Input value={assetUrl} onChange={(e) => setAssetUrl(e.target.value)} placeholder="https://drive.google.com/…" dir="ltr" />
          </Field>
          <Field label={t('fields.notes')} hint={t('workspace.deliverables.notesReviewerHint')}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={submit.isPending || uploading} onClick={() => submit.mutate()}>
            {submit.isPending ? t('workspace.deliverables.submitting') : t('workspace.deliverables.submitForReview')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeliverablesTab({ campaign, influencers }: { campaign: CampaignDetailDTO; influencers: CampaignInfluencerDTO[] }) {
  const t = useTranslations('campaigns');
  const [applyOpen, setApplyOpen] = React.useState(false);
  const rows = React.useMemo(() => {
    const flat = influencers.flatMap((ci) => ci.deliverables.map((d) => ({ ci, d })));
    return flat.sort((a, b) => {
      const at = a.d.dueDate ? new Date(a.d.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bt = b.d.dueDate ? new Date(b.d.dueDate).getTime() : Number.POSITIVE_INFINITY;
      return at - bt;
    });
  }, [influencers]);

  return (
    <div className="space-y-3">
      {influencers.length > 0 ? (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => setApplyOpen(true)}>
            <ListChecks className="h-4 w-4" /> {t('workspace.deliverables.applyToRoster')}
          </Button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={t('workspace.deliverables.emptyTitle')}
          description={t('workspace.deliverables.emptyDescription')}
        />
      ) : (
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
      )}
      <ApplyDeliverablesDialog campaignId={campaign.id} influencers={influencers} open={applyOpen} onOpenChange={setApplyOpen} />
    </div>
  );
}

type TemplateItem = { key: number; platform: Platform; type: DeliverableType; quantity: string; dueDate: string; requiresProduct: boolean };

/**
 * The same deliverables for many creators at once — "2 Reels and 3 Stories
 * each, due the 20th" — for the whole roster or the creators picked.
 */
function ApplyDeliverablesDialog({
  campaignId,
  influencers,
  open,
  onOpenChange,
}: {
  campaignId: string;
  influencers: CampaignInfluencerDTO[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const queryClient = useQueryClient();
  const nextKey = React.useRef(1);
  const blank = (): TemplateItem => ({
    key: nextKey.current++,
    platform: 'INSTAGRAM',
    type: 'REEL',
    quantity: '1',
    dueDate: '',
    requiresProduct: false,
  });
  const [items, setItems] = React.useState<TemplateItem[]>(() => [blank()]);
  const [everyone, setEveryone] = React.useState(true);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (open) {
      setItems([blank()]);
      setEveryone(true);
      setPicked(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (key: number, patch: Partial<TemplateItem>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const apply = useMutation({
    mutationFn: () =>
      api.campaigns.applyDeliverableTemplate(campaignId, {
        target: everyone ? 'all' : Array.from(picked),
        deliverables: items.map((it) => ({
          platform: it.platform,
          type: it.type,
          quantity: Math.min(100, Math.max(1, Number(it.quantity) || 1)),
          dueDate: it.dueDate ? new Date(`${it.dueDate}T12:00:00`) : undefined,
          requiresProduct: it.requiresProduct,
        })),
      }),
    onSuccess: (res) => {
      toast.success(
        t('workspace.deliverables.appliedToast', { created: res.deliverablesCreated, creators: res.rostersTargeted }),
      );
      queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const targetCount = everyone ? influencers.length : picked.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('workspace.deliverables.applyTitle')}</DialogTitle>
          <DialogDescription>{t('workspace.deliverables.applyDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {items.map((it) => (
            <div key={it.key} className="grid grid-cols-2 items-end gap-3 rounded-xl border border-border p-3 sm:grid-cols-[1fr_1fr_5rem_9.5rem_auto]">
              <Field label={t('fields.platform')}>
                <Select value={it.platform} onValueChange={(v) => update(it.key, { platform: v as Platform })}>
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
                <Select value={it.type} onValueChange={(v) => update(it.key, { type: v as DeliverableType })}>
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
                <Input type="number" min={1} max={100} value={it.quantity} onChange={(e) => update(it.key, { quantity: e.target.value })} />
              </Field>
              <Field label={t('fields.dueDate')}>
                <Input type="date" value={it.dueDate} onChange={(e) => update(it.key, { dueDate: e.target.value })} />
              </Field>
              <div className="flex items-center gap-2 pb-2">
                <label
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                  title={t('workspace.deliverables.physicalProductRequired')}
                >
                  <Switch
                    checked={it.requiresProduct}
                    onCheckedChange={(v) => update(it.key, { requiresProduct: v })}
                    aria-label={t('workspace.deliverables.physicalProductRequired')}
                  />
                  <Package className="h-3.5 w-3.5" />
                </label>
                {items.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('workspace.deliverables.removeTemplateRow')}
                    onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          {items.length < 50 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setItems((prev) => [...prev, blank()])}>
              <Plus className="h-3.5 w-3.5" /> {t('workspace.deliverables.addTemplateRow')}
            </Button>
          ) : null}
        </div>

        <div className="space-y-2 rounded-xl border border-border p-3">
          <label className="flex items-center justify-between gap-3 text-sm font-medium">
            {t('workspace.deliverables.applyEveryone', { count: influencers.length })}
            <Switch checked={everyone} onCheckedChange={setEveryone} aria-label={t('workspace.deliverables.applyEveryone', { count: influencers.length })} />
          </label>
          {everyone ? null : (
            <ul className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
              {influencers.map((ci) => (
                <li key={ci.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={picked.has(ci.id)}
                      onChange={(e) =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(ci.id);
                          else next.delete(ci.id);
                          return next;
                        })
                      }
                    />
                    <Avatar name={ci.influencer.displayName} src={ci.influencer.avatarUrl} size="xs" />
                    <BidiText className="truncate">{ci.influencer.displayName}</BidiText>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={apply.isPending || targetCount === 0} onClick={() => apply.mutate()}>
            {t('workspace.deliverables.applyButton', { count: targetCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/**
 * Add a deliverable to a roster row, or edit one (pass `deliverable`): what,
 * where and when, the brief, required hashtags and mentions, the script it
 * follows, internal notes, and whether it needs a product shipped first.
 */
export function DeliverableDialog({
  campaignInfluencer,
  deliverable,
  open,
  onOpenChange,
}: {
  campaignInfluencer: CampaignInfluencerDTO | null;
  deliverable?: DeliverableDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const queryClient = useQueryClient();
  const scripts = React.useContext(CampaignScriptsContext);
  const editing = !!deliverable;
  const [platform, setPlatform] = React.useState<Platform>('INSTAGRAM');
  const [type, setType] = React.useState<DeliverableType>('POST');
  const [quantity, setQuantity] = React.useState('1');
  const [dueDate, setDueDate] = React.useState('');
  const [requirements, setRequirements] = React.useState('');
  const [hashtags, setHashtags] = React.useState('');
  const [mentions, setMentions] = React.useState('');
  const [scriptId, setScriptId] = React.useState(NONE);
  const [internalNotes, setInternalNotes] = React.useState('');
  const [requiresProduct, setRequiresProduct] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (deliverable) {
      setPlatform(deliverable.platform);
      setType(deliverable.type);
      setQuantity(String(deliverable.quantity));
      setDueDate(toDateInputValue(deliverable.dueDate));
      setRequirements(deliverable.requirements ?? '');
      setHashtags(deliverable.requiredHashtags.join(', '));
      setMentions(deliverable.requiredMentions.join(', '));
      setScriptId(deliverable.scriptReferenceId ?? NONE);
      setInternalNotes(deliverable.internalNotes ?? '');
      setRequiresProduct(deliverable.requiresProduct);
    } else if (campaignInfluencer) {
      setPlatform(campaignInfluencer.influencer.primaryPlatform ?? 'INSTAGRAM');
      setType('POST');
      setQuantity('1');
      setDueDate('');
      setRequirements('');
      setHashtags('');
      setMentions('');
      setScriptId(NONE);
      setInternalNotes('');
      setRequiresProduct(false);
    }
  }, [open, deliverable, campaignInfluencer]);

  const save = useMutation({
    mutationFn: () => {
      const fields = {
        platform,
        type,
        quantity: Math.min(100, Math.max(1, Number(quantity) || 1)),
        requiresProduct,
        requiredHashtags: splitList(hashtags).map((h) => (h.startsWith('#') ? h : `#${h}`)),
        requiredMentions: splitList(mentions).map((m) => (m.startsWith('@') ? m : `@${m}`)),
      };
      if (deliverable) {
        return api.deliverables.update(deliverable.id, {
          ...fields,
          dueDate: dueDate ? new Date(`${dueDate}T12:00:00`) : null,
          requirements: requirements.trim() || null,
          scriptReferenceId: scriptId === NONE ? null : scriptId,
          internalNotes: internalNotes.trim() || null,
        });
      }
      if (!campaignInfluencer) throw new Error(t('workspace.deliverables.noInfluencerSelected'));
      return api.campaignInfluencers.addDeliverable(campaignInfluencer.id, {
        ...fields,
        dueDate: dueDate ? new Date(`${dueDate}T12:00:00`) : undefined,
        requirements: requirements.trim() || undefined,
        scriptReferenceId: scriptId === NONE ? undefined : scriptId,
        internalNotes: internalNotes.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success(editing ? t('workspace.deliverables.updatedToast') : t('workspace.deliverables.addedToast'));
      queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const name = campaignInfluencer?.influencer.displayName;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? t('workspace.deliverables.editTitle') : t('workspace.deliverables.addDeliverable')}</DialogTitle>
          <DialogDescription>
            {editing
              ? t('workspace.deliverables.editDescription')
              : name
                ? t('workspace.deliverables.addDialogDescriptionNamed', { name })
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
          <Field label={t('workspace.deliverables.hashtagsLabel')} hint={t('workspace.deliverables.listHint')}>
            <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#brand, #ramadan" dir="ltr" />
          </Field>
          <Field label={t('workspace.deliverables.mentionsLabel')} hint={t('workspace.deliverables.listHint')}>
            <Input value={mentions} onChange={(e) => setMentions(e.target.value)} placeholder="@brand" dir="ltr" />
          </Field>
          {scripts.length > 0 ? (
            <Field label={t('workspace.deliverables.scriptLabel')} hint={t('fields.optionalHint')} className="col-span-2">
              <Select value={scriptId} onValueChange={setScriptId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('workspace.deliverables.noScript')}</SelectItem>
                  {scripts.map((sc) => (
                    <SelectItem key={sc.id} value={sc.id}>
                      <BidiText>{sc.title}</BidiText>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label={t('workspace.deliverables.internalNotesLabel')} hint={t('workspace.deliverables.internalNotesHint')} className="col-span-2">
            <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} />
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
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending
              ? tCommon('saving')
              : editing
                ? t('workspace.saveChanges')
                : t('workspace.deliverables.addDeliverable')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
