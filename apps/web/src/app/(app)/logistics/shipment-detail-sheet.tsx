'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, ExternalLink, MapPin, MessageSquare, Package, Pencil, Truck, UserPlus, X } from 'lucide-react';
import type { LogisticsIssueDTO, LogisticsRequestDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import {
  ADDRESS_HEALTH_LABELS,
  ADDRESS_HEALTH_TONE,
  countryName,
  DELIVERABLE_TYPE_LABELS,
  LOGISTICS_ISSUE_STATUS_TONE,
  LOGISTICS_ISSUE_TYPES,
  LOGISTICS_ISSUE_TYPE_LABELS,
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONE,
} from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CommentThread } from '@/components/collaboration/comment-thread';
import { useApp } from '@/components/shell/app-context';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong.';
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

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['logistics'] });
    queryClient.invalidateQueries({ queryKey: ['logistics-summary'] });
  }

  const directory = useQuery({ queryKey: ['team-directory'], queryFn: () => api.users.directory(), enabled: open, staleTime: 60_000 });

  const assign = useMutation({
    mutationFn: (userId: string | null) => api.shipments.assign(shipment!.id, userId),
    onSuccess: () => {
      toast.success('Assignment updated.');
      invalidateAll();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const updateStatus = useMutation({
    mutationFn: (status: (typeof SHIPMENT_STATUSES)[number]) => api.shipments.updateStatus(shipment!.id, { status }),
    onSuccess: () => {
      toast.success('Status updated.');
      invalidateAll();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
      <SheetContent side="right" className="sm:max-w-2xl gap-5">
        {!shipment ? null : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Package className="h-4 w-4 text-accent" /> Shipment
              </SheetTitle>
              <SheetDescription>
                {shipment.brand?.name} · {shipment.campaign?.name}
                {shipment.deliverableType ? ` · ${DELIVERABLE_TYPE_LABELS[shipment.deliverableType]}` : ''}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted/40 p-3">
              <div className="flex items-center gap-2.5">
                {shipment.influencer ? (
                  <Link href={`/influencers/${shipment.influencer.id}`} className="flex items-center gap-2.5 hover:underline">
                    <Avatar name={shipment.influencer.displayName} src={shipment.influencer.avatarUrl} size="sm" />
                    <div>
                      <div className="font-medium">{shipment.influencer.displayName}</div>
                      <div className="text-xs text-muted-foreground">
                        Creator country: {countryName(shipment.influencer.countryCode) ?? shipment.influencer.countryCode ?? '—'}
                      </div>
                    </div>
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Unassigned creator</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={SHIPMENT_STATUS_TONE[shipment.status]}>{SHIPMENT_STATUS_LABELS[shipment.status]}</Badge>
                <Badge tone={ADDRESS_HEALTH_TONE[shipment.addressHealth]}>{ADDRESS_HEALTH_LABELS[shipment.addressHealth]}</Badge>
              </div>
            </div>

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2">
              {shipment.campaign && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/campaigns/${shipment.campaign.id}`}>Open Campaign</Link>
                </Button>
              )}
              {shipment.influencer && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/influencers/${shipment.influencer.id}`}>Open Creator</Link>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5">
                    <UserPlus className="h-3.5 w-3.5" />
                    {shipment.assignedToName ? `Assigned: ${shipment.assignedToName}` : 'Unassigned'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                  <DropdownMenuItem onSelect={() => assign.mutate(user.id)}>Assign to me</DropdownMenuItem>
                  {shipment.assignedToUserId && <DropdownMenuItem onSelect={() => assign.mutate(null)}>Unassign</DropdownMenuItem>}
                  {(directory.data ?? [])
                    .filter((d) => d.id !== user.id)
                    .map((d) => (
                      <DropdownMenuItem key={d.id} onSelect={() => assign.mutate(d.id)}>
                        {d.name}
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
                      {SHIPMENT_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs text-muted-foreground">
              Requester: {shipment.createdByName ?? '—'} · Created {relativeTime(shipment.createdAt)}
            </p>

            <Separator />

            <FulfilmentDetails shipment={shipment} onSaved={invalidateAll} />

            <Separator />

            <IssueSection shipment={shipment} onChanged={invalidateAll} />

            <Separator />

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <MessageSquare className="h-4 w-4 text-accent" /> Comments on this shipment
              </p>
              <CommentThread
                context={{ shipmentId: shipment.id }}
                cacheKey={`shipment-${shipment.id}`}
                emptyTitle="No comments yet"
                emptyDescription="e.g. &ldquo;@Mona please confirm the building number&rdquo; — specific to this shipment only."
                composerPlaceholder="Comment on this shipment… use @ to mention someone"
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FulfilmentDetails({ shipment, onSaved }: { shipment: LogisticsRequestDTO; onSaved: () => void }) {
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

  const save = useMutation({
    mutationFn: () =>
      api.shipments.update(shipment.id, {
        recipientName: form.recipientName || null,
        phone: form.phone || null,
        addressLine1: form.addressLine1 || null,
        addressLine2: form.addressLine2 || null,
        city: form.city || null,
        country: form.country || null,
        postalCode: form.postalCode || null,
        deliveryInstructions: form.deliveryInstructions || null,
        courier: form.courier || null,
        trackingNumber: form.trackingNumber || null,
        trackingUrl: form.trackingUrl || null,
      }),
    onSuccess: () => {
      toast.success('Shipment details saved.');
      setEditing(false);
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const trackable = !!shipment.trackingUrl && /^https?:\/\//i.test(shipment.trackingUrl);

  if (!editing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <MapPin className="h-4 w-4 text-accent" /> Fulfilment details
          </p>
          <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <Row label="Recipient" value={shipment.recipientName} />
          <Row label="Phone" value={shipment.phone} />
          <Row label="Address" value={[shipment.addressLine1, shipment.addressLine2].filter(Boolean).join(', ') || null} />
          <Row label="City / Country" value={[shipment.city, shipment.country].filter(Boolean).join(', ') || null} />
          <Row label="Destination" value={countryName(shipment.destinationCountryCode) ?? shipment.destinationCountryCode} />
          <Row label="Postal code" value={shipment.postalCode} />
          <Row label="Delivery instructions" value={shipment.deliveryInstructions} full />
          <Row label="Courier" value={shipment.courier} />
          <Row
            label="Tracking"
            value={
              shipment.trackingNumber ? (
                trackable ? (
                  <a href={shipment.trackingUrl!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                    {shipment.trackingNumber} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  shipment.trackingNumber
                )
              ) : null
            }
          />
        </dl>
        {shipment.items.length > 0 && (
          <div className="pt-1 text-sm">
            <span className="text-muted-foreground">Products: </span>
            {shipment.items.map((it) => `${it.productName}${it.quantity > 1 ? ` ×${it.quantity}` : ''}`).join(', ')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Truck className="h-4 w-4 text-accent" /> Edit fulfilment details
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Recipient name">
          <Input value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Address line 1" className="col-span-2">
          <Input value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
        </Field>
        <Field label="Address line 2" className="col-span-2">
          <Input value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} />
        </Field>
        <Field label="City">
          <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <Field label="Country (free text)">
          <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
        </Field>
        <Field label="Postal code">
          <Input value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
        </Field>
        <Field label="Delivery instructions" className="col-span-2">
          <Textarea rows={2} value={form.deliveryInstructions} onChange={(e) => setForm({ ...form, deliveryInstructions: e.target.value })} />
        </Field>
        <Field label="Courier">
          <Input value={form.courier} onChange={(e) => setForm({ ...form, courier: e.target.value })} />
        </Field>
        <Field label="Tracking / waybill number">
          <Input value={form.trackingNumber} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })} />
        </Field>
        <Field label="Tracking URL" className="col-span-2">
          <Input value={form.trackingUrl} onChange={(e) => setForm({ ...form, trackingUrl: e.target.value })} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
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
      toast.success('Address clarification requested.');
      setRequesting(false);
      setDescription('');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const resolve = useMutation({
    mutationFn: async (issue: LogisticsIssueDTO) => {
      if (updateDefaultAddress && shipment.influencer) {
        await api.influencers.update(shipment.influencer.id, {
          addressLine1: shipment.addressLine1,
          addressLine2: shipment.addressLine2,
          city: shipment.city,
          country: shipment.country,
          countryCode: shipment.destinationCountryCode,
          postalCode: shipment.postalCode,
          deliveryInstructions: shipment.deliveryInstructions,
          mobile: shipment.phone ?? undefined,
        });
      }
      return api.logisticsIssues.resolve(issue.id);
    },
    onSuccess: () => {
      toast.success('Issue resolved.');
      setUpdateDefaultAddress(false);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const cancel = useMutation({
    mutationFn: (issue: LogisticsIssueDTO) => api.logisticsIssues.cancel(issue.id),
    onSuccess: () => {
      toast.success('Issue cancelled.');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const issues = issuesQuery.data ?? [];
  const open = issues.find((i) => i.status === 'OPEN');
  const past = issues.filter((i) => i.status !== 'OPEN');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Address clarification</p>
        {!open && !requesting && (
          <Button type="button" variant="outline" size="sm" onClick={() => setRequesting(true)}>
            Request Address Clarification
          </Button>
        )}
      </div>

      {open && (
        <div className="space-y-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
          <div className="flex items-center justify-between">
            <Badge tone={LOGISTICS_ISSUE_STATUS_TONE[open.status]}>{LOGISTICS_ISSUE_TYPE_LABELS[open.type]}</Badge>
            <span className="text-xs text-muted-foreground">Opened by {open.createdByName ?? 'someone'} · {relativeTime(open.createdAt)}</span>
          </div>
          <p className="text-sm text-foreground/90">{open.description}</p>
          {open.assignedToName && <p className="text-xs text-muted-foreground">Responsible: {open.assignedToName}</p>}
          <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer rounded border-border accent-brand"
              checked={updateDefaultAddress}
              onChange={(e) => setUpdateDefaultAddress(e.target.checked)}
            />
            Update creator&rsquo;s default shipping address too (applies only going forward — this shipment&rsquo;s own record is never rewritten)
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate(open)}>
              Cancel issue
            </Button>
            <Button type="button" size="sm" disabled={resolve.isPending} onClick={() => resolve.mutate(open)}>
              {resolve.isPending ? 'Resolving…' : 'Resolve'}
            </Button>
          </div>
        </div>
      )}

      {requesting && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <Field label="Issue type">
            <Select value={issueType} onValueChange={(v) => setIssueType(v as (typeof LOGISTICS_ISSUE_TYPES)[number])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOGISTICS_ISSUE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {LOGISTICS_ISSUE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="What's unclear?">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Building number is missing from the address." />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setRequesting(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={!description.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Sending…' : 'Send request'}
            </Button>
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">History</p>
          {past.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs">
              <span className="flex items-center gap-1.5">
                {i.status === 'RESOLVED' ? <Check className="h-3 w-3 text-success" /> : <X className="h-3 w-3 text-muted-foreground" />}
                {LOGISTICS_ISSUE_TYPE_LABELS[i.type]}
              </span>
              <Badge tone={LOGISTICS_ISSUE_STATUS_TONE[i.status]}>{i.status === 'RESOLVED' ? `Resolved by ${i.resolvedByName ?? '—'}` : 'Cancelled'}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
