'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity as ActivityIcon, Check, ExternalLink, MapPin, MessageSquare, Package, Pencil, Truck, UserPlus, X } from 'lucide-react';
import type { LogisticsIssueDTO, LogisticsRequestDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import {
  ADDRESS_HEALTH_TONE,
  countryName,
  LOGISTICS_ISSUE_STATUS_TONE,
  LOGISTICS_ISSUE_TYPES,
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_TONE,
} from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CommentThread } from '@/components/collaboration/comment-thread';
import { ActivityFeed } from '@/components/common/activity-feed';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { useApp } from '@/components/shell/app-context';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/**
 * The Logistics workspace's shipment detail — opened from a row click.
 * Everything here reads/writes the SAME ProductShipment row the campaign's
 * Shipments tab shows; comments reuse the SAME Collaboration Layer, scoped
 * to this one shipment (distinct from the always-open Logistics Team Chat).
 */
export function ShipmentDetailSheet({
  shipment,
  onOpenChange,
}: {
  shipment: LogisticsRequestDTO | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = shipment != null;
  const queryClient = useQueryClient();
  const { user } = useApp();
  const t = useTranslations('logistics');
  const tc = useTranslations('common');
  const te = useTranslations('enums');

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['logistics'] });
    queryClient.invalidateQueries({ queryKey: ['logistics-summary'] });
  }

  const directory = useQuery({ queryKey: ['team-directory'], queryFn: () => api.users.directory(), enabled: open, staleTime: 60_000 });

  const assign = useMutation({
    mutationFn: (userId: string | null) => api.shipments.assign(shipment!.id, userId),
    onSuccess: () => {
      toast.success(t('detail.toastAssignmentUpdated'));
      invalidateAll();
    },
    onError: (e) => toast.error(errorMessage(e, tc('somethingWentWrong'))),
  });

  const updateStatus = useMutation({
    mutationFn: (status: (typeof SHIPMENT_STATUSES)[number]) => api.shipments.updateStatus(shipment!.id, { status }),
    onSuccess: () => {
      toast.success(t('detail.toastStatusUpdated'));
      invalidateAll();
    },
    onError: (e) => toast.error(errorMessage(e, tc('somethingWentWrong'))),
  });

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
      <SheetContent side="right" className="sm:max-w-2xl gap-5">
        {!shipment ? null : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Package className="h-4 w-4 text-accent" /> {t('detail.title')}
              </SheetTitle>
              <SheetDescription>
                {shipment.brand?.name} · {shipment.campaign?.name}
                {shipment.deliverableType ? ` · ${enumLabel(te, 'deliverableType', shipment.deliverableType)}` : ''}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted/40 p-3">
              <div className="flex items-center gap-2.5">
                {shipment.influencer ? (
                  <Link href={`/influencers/${shipment.influencer.id}`} className="flex items-center gap-2.5 hover:underline">
                    <Avatar name={shipment.influencer.displayName} src={shipment.influencer.avatarUrl} size="sm" />
                    <div>
                      <BidiText as="div" className="font-medium">
                        {shipment.influencer.displayName}
                      </BidiText>
                      <div className="text-xs text-muted-foreground">
                        {t('detail.creatorCountryLabel', {
                          country: countryName(shipment.influencer.countryCode) ?? shipment.influencer.countryCode ?? '—',
                        })}
                      </div>
                    </div>
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{t('detail.unassignedCreator')}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={SHIPMENT_STATUS_TONE[shipment.status]}>{enumLabel(te, 'shipmentStatus', shipment.status)}</Badge>
                <Badge tone={ADDRESS_HEALTH_TONE[shipment.addressHealth]}>{enumLabel(te, 'addressHealth', shipment.addressHealth)}</Badge>
              </div>
            </div>

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2">
              {shipment.campaign && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/campaigns/${shipment.campaign.id}`}>{t('detail.openCampaign')}</Link>
                </Button>
              )}
              {shipment.influencer && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/influencers/${shipment.influencer.id}`}>{t('detail.openCreator')}</Link>
                </Button>
              )}
              {/* The specific Deliverable this shipment fulfils, not just its
                  campaign — a shipment may be tied to one (deliverableId), or be
                  a general/replacement gift with none. */}
              {shipment.deliverableId && shipment.campaign && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/campaigns/${shipment.campaign.id}?tab=deliverables`}>{t('detail.openDeliverable')}</Link>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5">
                    <UserPlus className="h-3.5 w-3.5" />
                    {shipment.assignedToName ? t('detail.assignedTo', { name: shipment.assignedToName }) : tc('unassigned')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                  <DropdownMenuItem onSelect={() => assign.mutate(user.id)}>{t('detail.assignToMe')}</DropdownMenuItem>
                  {shipment.assignedToUserId && <DropdownMenuItem onSelect={() => assign.mutate(null)}>{t('detail.unassign')}</DropdownMenuItem>}
                  {(directory.data ?? [])
                    .filter((d) => d.id !== user.id)
                    .map((d) => (
                      <DropdownMenuItem key={d.id} onSelect={() => assign.mutate(d.id)}>
                        <BidiText>{d.name}</BidiText>
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Select value={shipment.status} onValueChange={(v) => updateStatus.mutate(v as (typeof SHIPMENT_STATUSES)[number])} disabled={updateStatus.isPending}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHIPMENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {enumLabel(te, 'shipmentStatus', s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs text-muted-foreground">
              {t('detail.requesterCreated', { requester: shipment.createdByName ?? '—', created: relativeTime(shipment.createdAt) })}
            </p>

            <Separator />

            <FulfilmentDetails shipment={shipment} onSaved={invalidateAll} />

            <Separator />

            <IssueSection shipment={shipment} onChanged={invalidateAll} />

            <Separator />

            {/* Factual system history (ActivityLog) — the SAME ActivityFeed the
                Campaign workspace's Activity tab shows, scoped to this shipment
                (created, assigned, status transitions, address clarification
                requested/resolved). Rendered as a shaded panel — the same visual
                language as the creator/status summary above — to read as system
                fact, distinct from the plain-header Comments discussion, the
                LogisticsIssue banner above, and the Fulfilment/tracking details. */}
            <div className="space-y-2 rounded-xl border border-border bg-surface-muted/40 p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                <ActivityIcon className="h-4 w-4 text-accent" /> {t('detail.activity')}
              </p>
              <ActivityFeed
                filter={{ shipmentId: shipment.id, limit: 20 }}
                queryKey={['shipment-activity', shipment.id]}
                emptyTitle={t('detail.activityEmptyTitle')}
                emptyDescription={t('detail.activityEmptyDescription')}
              />
            </div>

            <Separator />

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <MessageSquare className="h-4 w-4 text-accent" /> {t('detail.commentsHeading')}
              </p>
              <CommentThread
                context={{ shipmentId: shipment.id }}
                cacheKey={`shipment-${shipment.id}`}
                emptyTitle={t('detail.commentsEmptyTitle')}
                emptyDescription={t('detail.commentsEmptyDescription')}
                composerPlaceholder={t('detail.commentsPlaceholder')}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FulfilmentDetails({ shipment, onSaved }: { shipment: LogisticsRequestDTO; onSaved: () => void }) {
  const t = useTranslations('logistics');
  const tc = useTranslations('common');
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState({
    recipientName: shipment.recipientName ?? '',
    phone: shipment.phone ?? '',
    addressLine1: shipment.addressLine1 ?? '',
    addressLine2: shipment.addressLine2 ?? '',
    city: shipment.city ?? '',
    country: shipment.country ?? '',
    postalCode: shipment.postalCode ?? '',
    deliveryInstructions: shipment.deliveryInstructions ?? '',
    courier: shipment.courier ?? '',
    trackingNumber: shipment.trackingNumber ?? '',
    trackingUrl: shipment.trackingUrl ?? '',
  });

  React.useEffect(() => {
    if (!editing) {
      setForm({
        recipientName: shipment.recipientName ?? '',
        phone: shipment.phone ?? '',
        addressLine1: shipment.addressLine1 ?? '',
        addressLine2: shipment.addressLine2 ?? '',
        city: shipment.city ?? '',
        country: shipment.country ?? '',
        postalCode: shipment.postalCode ?? '',
        deliveryInstructions: shipment.deliveryInstructions ?? '',
        courier: shipment.courier ?? '',
        trackingNumber: shipment.trackingNumber ?? '',
        trackingUrl: shipment.trackingUrl ?? '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipment.id, editing]);

  // Diff-only PATCH: a role with LOGISTICS_MANAGE but not LOGISTICS_ADDRESS_EDIT
  // (e.g. GENERAL_MANAGER, by design — see shipment.service.ts's update()) can
  // still edit courier/tracking here. Sending every field unconditionally would
  // trip the backend's address-field gate even when no address field actually
  // changed, blocking a save the role is meant to be able to make. Only the
  // fields the user actually touched are sent.
  const original = {
    recipientName: shipment.recipientName ?? '',
    phone: shipment.phone ?? '',
    addressLine1: shipment.addressLine1 ?? '',
    addressLine2: shipment.addressLine2 ?? '',
    city: shipment.city ?? '',
    country: shipment.country ?? '',
    postalCode: shipment.postalCode ?? '',
    deliveryInstructions: shipment.deliveryInstructions ?? '',
    courier: shipment.courier ?? '',
    trackingNumber: shipment.trackingNumber ?? '',
    trackingUrl: shipment.trackingUrl ?? '',
  };
  const save = useMutation({
    mutationFn: () => {
      const changed: Record<string, string | null> = {};
      for (const key of Object.keys(original) as (keyof typeof original)[]) {
        if (form[key] !== original[key]) changed[key] = form[key] || null;
      }
      return api.shipments.update(shipment.id, changed);
    },
    onSuccess: () => {
      toast.success(t('detail.toastShipmentSaved'));
      setEditing(false);
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e, tc('somethingWentWrong'))),
  });

  const trackable = !!shipment.trackingUrl && /^https?:\/\//i.test(shipment.trackingUrl);

  if (!editing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <MapPin className="h-4 w-4 text-accent" /> {t('detail.fulfilmentDetails')}
          </p>
          <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> {tc('edit')}
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <Row label={t('form.recipient')} value={shipment.recipientName ? <BidiText>{shipment.recipientName}</BidiText> : null} />
          <Row label={t('form.phone')} value={shipment.phone ? <LtrText>{shipment.phone}</LtrText> : null} />
          <Row label={t('form.address')} value={[shipment.addressLine1, shipment.addressLine2].filter(Boolean).join(', ') || null} />
          <Row label={t('detail.cityCountry')} value={[shipment.city, shipment.country].filter(Boolean).join(', ') || null} />
          <Row label={t('detail.destinationCountry')} value={countryName(shipment.destinationCountryCode) ?? shipment.destinationCountryCode} />
          <Row label={t('form.postalCode')} value={shipment.postalCode} />
          <Row label={t('form.deliveryInstructions')} value={shipment.deliveryInstructions} full />
          <Row label={t('form.courier')} value={shipment.courier} />
          <Row
            label={t('form.tracking')}
            value={
              shipment.trackingNumber ? (
                trackable ? (
                  <a href={shipment.trackingUrl!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                    <LtrText>{shipment.trackingNumber}</LtrText> <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <LtrText>{shipment.trackingNumber}</LtrText>
                )
              ) : null
            }
          />
        </dl>
        {shipment.items.length > 0 && (
          <div className="pt-1 text-sm">
            <span className="text-muted-foreground">{t('detail.productsLabel')}: </span>
            {shipment.items.map((it) => `${it.productName}${it.quantity > 1 ? ` ×${it.quantity}` : ''}`).join(', ')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Truck className="h-4 w-4 text-accent" /> {t('detail.editFulfilmentDetails')}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('form.recipientName')}>
          <Input value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} />
        </Field>
        <Field label={t('form.phone')}>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label={t('form.addressLine1')} className="col-span-2">
          <Input value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
        </Field>
        <Field label={t('form.addressLine2')} className="col-span-2">
          <Input value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} />
        </Field>
        <Field label={t('form.city')}>
          <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <Field label={t('form.countryFreeText')}>
          <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
        </Field>
        <Field label={t('form.postalCode')}>
          <Input value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
        </Field>
        <Field label={t('form.deliveryInstructions')} className="col-span-2">
          <Textarea rows={2} value={form.deliveryInstructions} onChange={(e) => setForm({ ...form, deliveryInstructions: e.target.value })} />
        </Field>
        <Field label={t('form.courier')}>
          <Input value={form.courier} onChange={(e) => setForm({ ...form, courier: e.target.value })} />
        </Field>
        <Field label={t('form.trackingWaybillNumber')}>
          <Input value={form.trackingNumber} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })} />
        </Field>
        <Field label={t('form.trackingUrl')} className="col-span-2">
          <Input value={form.trackingUrl} onChange={(e) => setForm({ ...form, trackingUrl: e.target.value })} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
          {tc('cancel')}
        </Button>
        <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? tc('saving') : tc('save')}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value, full }: { label: string; value: React.ReactNode; full?: boolean }) {
  if (!value) return null;
  return (
    <div className={full ? 'col-span-2' : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function IssueSection({ shipment, onChanged }: { shipment: LogisticsRequestDTO; onChanged: () => void }) {
  const t = useTranslations('logistics');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
  const queryClient = useQueryClient();
  const [requesting, setRequesting] = React.useState(false);
  const [issueType, setIssueType] = React.useState<(typeof LOGISTICS_ISSUE_TYPES)[number]>('MISSING_ADDRESS');
  const [description, setDescription] = React.useState('');
  const [updateDefaultAddress, setUpdateDefaultAddress] = React.useState(false);

  const issuesQuery = useQuery({
    queryKey: ['shipment-issues', shipment.id],
    queryFn: () => api.logisticsIssues.list(shipment.id),
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['shipment-issues', shipment.id] });
    onChanged();
  }

  const create = useMutation({
    mutationFn: () => api.logisticsIssues.create(shipment.id, { type: issueType, description: description.trim() }),
    onSuccess: () => {
      toast.success(t('addressClarification.toastRequested'));
      setRequesting(false);
      setDescription('');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tc('somethingWentWrong'))),
  });

  const resolve = useMutation({
    mutationFn: async (issue: LogisticsIssueDTO) => {
      let addressUpdateFailed = false;
      if (updateDefaultAddress && shipment.influencer) {
        // Best-effort: a creator's own country can differ from this
        // shipment's destination (e.g. a one-off delivery outside their
        // usual market), which can put the creator's profile outside this
        // actor's own country scope even though the shipment itself is in
        // scope. That must never block resolving the actual issue — it's
        // reported, not swallowed.
        try {
          await api.influencers.update(shipment.influencer.id, {
            addressLine1: shipment.addressLine1,
            addressLine2: shipment.addressLine2,
            city: shipment.city,
            country: shipment.country,
            // countryCode is required on the influencer profile — only send it
            // when the shipment actually has one, never clear an existing
            // profile country just because this particular shipment lacks one.
            countryCode: shipment.destinationCountryCode ?? undefined,
            postalCode: shipment.postalCode,
            deliveryInstructions: shipment.deliveryInstructions,
            mobile: shipment.phone ?? undefined,
          });
        } catch {
          addressUpdateFailed = true;
        }
      }
      const resolved = await api.logisticsIssues.resolve(issue.id);
      return { resolved, addressUpdateFailed };
    },
    onSuccess: ({ addressUpdateFailed }) => {
      if (addressUpdateFailed) {
        toast.warning(t('detail.toastIssueResolvedAddressUpdateFailed'));
      } else {
        toast.success(t('detail.toastIssueResolved'));
      }
      setUpdateDefaultAddress(false);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tc('somethingWentWrong'))),
  });

  const cancel = useMutation({
    mutationFn: (issue: LogisticsIssueDTO) => api.logisticsIssues.cancel(issue.id),
    onSuccess: () => {
      toast.success(t('detail.toastIssueCancelled'));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tc('somethingWentWrong'))),
  });

  const issues = issuesQuery.data ?? [];
  const open = issues.find((i) => i.status === 'OPEN');
  const past = issues.filter((i) => i.status !== 'OPEN');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{t('addressClarification.heading')}</p>
        {!open && !requesting && (
          <Button type="button" variant="outline" size="sm" onClick={() => setRequesting(true)}>
            {t('addressClarification.requestButton')}
          </Button>
        )}
      </div>

      {open && (
        <div className="space-y-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
          <div className="flex items-center justify-between">
            <Badge tone={LOGISTICS_ISSUE_STATUS_TONE[open.status]}>{enumLabel(te, 'logisticsIssueType', open.type)}</Badge>
            <span className="text-xs text-muted-foreground">
              {t('addressClarification.openedBy', {
                name: open.createdByName ?? t('addressClarification.someone'),
                time: relativeTime(open.createdAt),
              })}
            </span>
          </div>
          <p className="text-sm text-foreground/90">{open.description}</p>
          {open.assignedToName && <p className="text-xs text-muted-foreground">{t('addressClarification.responsible', { name: open.assignedToName })}</p>}
          <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer rounded border-border accent-brand"
              checked={updateDefaultAddress}
              onChange={(e) => setUpdateDefaultAddress(e.target.checked)}
            />
            {t('addressClarification.updateDefaultAddress')}
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate(open)}>
              {t('addressClarification.cancelIssue')}
            </Button>
            <Button type="button" size="sm" disabled={resolve.isPending} onClick={() => resolve.mutate(open)}>
              {resolve.isPending ? t('addressClarification.resolving') : t('addressClarification.resolve')}
            </Button>
          </div>
        </div>
      )}

      {requesting && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <Field label={t('addressClarification.issueType')}>
            <Select value={issueType} onValueChange={(v) => setIssueType(v as (typeof LOGISTICS_ISSUE_TYPES)[number])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOGISTICS_ISSUE_TYPES.map((issueTypeOption) => (
                  <SelectItem key={issueTypeOption} value={issueTypeOption}>
                    {enumLabel(te, 'logisticsIssueType', issueTypeOption)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('addressClarification.whatsUnclear')}>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('addressClarification.descriptionPlaceholder')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setRequesting(false)}>
              {tc('cancel')}
            </Button>
            <Button type="button" size="sm" disabled={!description.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? t('addressClarification.sending') : t('addressClarification.sendRequest')}
            </Button>
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('addressClarification.history')}</p>
          {past.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs">
              <span className="flex items-center gap-1.5">
                {i.status === 'RESOLVED' ? <Check className="h-3 w-3 text-success" /> : <X className="h-3 w-3 text-muted-foreground" />}
                {enumLabel(te, 'logisticsIssueType', i.type)}
              </span>
              <Badge tone={LOGISTICS_ISSUE_STATUS_TONE[i.status]}>
                {i.status === 'RESOLVED' ? t('addressClarification.resolvedBy', { name: i.resolvedByName ?? '—' }) : enumLabel(te, 'logisticsIssueStatus', 'CANCELLED')}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
