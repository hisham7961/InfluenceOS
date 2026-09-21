'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, MessageSquare, Package, Plus, Trash2 } from 'lucide-react';
import type { CampaignInfluencerDTO, ProductShipmentDTO } from '@influenceos/contracts';
import { DELIVERABLE_TYPE_LABELS, SHIPMENT_STATUSES, SHIPMENT_STATUS_LABELS, SHIPMENT_STATUS_TONE } from '@influenceos/shared';
import { ApiError } from '@influenceos/api-client';

// Tracking URLs are scheme-guarded on write; still gate the anchor to http(s).
const isHttpUrl = (u: string | null): u is string => !!u && /^https?:\/\//i.test(u);
const NONE = '__none__';

import { api } from '@/lib/api-browser';
import { CommentThread } from '@/components/collaboration/comment-thread';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong.';
}

/** Logistics fulfilment requests across a campaign roster (evolved W3-5 web
 *  surface): who a product went to, what it was, courier + tracking, and
 *  delivery status. One creator may have several — one per deliverable that
 *  needs a product, plus general gifts. Fully interactive: create + advance
 *  status here, the same rows the `/logistics` cross-campaign workspace reads. */
export function ShipmentsTab({ campaignId, influencers }: { campaignId: string; influencers: CampaignInfluencerDTO[] }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-shipments', campaignId],
    queryFn: () => api.campaigns.shipments(campaignId),
  });
  const [createOpen, setCreateOpen] = React.useState(false);
  const [commentsShipmentId, setCommentsShipmentId] = React.useState<string | null>(null);

  const byCi = new Map(influencers.map((ci) => [ci.id, ci]));

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <EmptyState icon={Package} title="Couldn't load shipments" description="Something went wrong fetching logistics requests. Try again shortly." />;
  }

  const shipments = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create shipment
        </Button>
      </div>

      {shipments.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No shipments yet"
          description="Logistics requests for gifted or UGC-product creators will appear here with courier, tracking and delivery status."
        />
      ) : (
        <Card className="overflow-hidden">
          <TableScroll>
            <Table className="min-w-[860px]">
              <TableHead>
                <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                  <TableHeaderCell className="ps-5">Creator</TableHeaderCell>
                  <TableHeaderCell>Products</TableHeaderCell>
                  <TableHeaderCell>Destination</TableHeaderCell>
                  <TableHeaderCell>Courier / Tracking</TableHeaderCell>
                  <TableHeaderCell align="end" className="pe-5">
                    Status
                  </TableHeaderCell>
                  <TableHeaderCell align="end" className="pe-5" />
                </TableRow>
              </TableHead>
              <TableBody>
                {shipments.map((s) => {
                  const inf = byCi.get(s.campaignInfluencerId)?.influencer;
                  const trackable = isHttpUrl(s.trackingUrl);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="ps-5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={inf?.displayName ?? 'Unknown'} src={inf?.avatarUrl ?? undefined} size="xs" />
                          <span className="truncate font-medium">{inf?.displayName ?? 'Unassigned'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-muted-foreground">
                        {s.items.length > 0
                          ? s.items.map((it) => `${it.productName}${it.quantity > 1 ? ` ×${it.quantity}` : ''}`).join(', ')
                          : '—'}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground">
                        {[s.city, s.country].filter(Boolean).join(', ') || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.courier ? `${s.courier} · ` : ''}
                        {s.trackingNumber ? (
                          trackable ? (
                            <a
                              href={s.trackingUrl!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-brand hover:underline"
                            >
                              {s.trackingNumber} <ExternalLink className="size-3.5" aria-hidden />
                            </a>
                          ) : (
                            s.trackingNumber
                          )
                        ) : s.courier ? (
                          '—'
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell align="end" className="pe-5">
                        <StatusCell shipment={s} />
                      </TableCell>
                      <TableCell align="end" className="pe-5">
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Comments" onClick={() => setCommentsShipmentId(s.id)}>
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScroll>
        </Card>
      )}

      <CreateShipmentDialog influencers={influencers} open={createOpen} onOpenChange={setCreateOpen} />

      <Dialog open={commentsShipmentId != null} onOpenChange={(open) => !open && setCommentsShipmentId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Shipment comments</DialogTitle>
          </DialogHeader>
          {commentsShipmentId ? (
            <CommentThread
              context={{ shipmentId: commentsShipmentId }}
              cacheKey={`shipment:${commentsShipmentId}`}
              emptyTitle="No comments yet"
              emptyDescription="Discuss this shipment with your team."
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusCell({ shipment }: { shipment: ProductShipmentDTO }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (status: (typeof SHIPMENT_STATUSES)[number]) => api.shipments.updateStatus(shipment.id, { status }),
    onSuccess: () => {
      toast.success('Status updated.');
      queryClient.invalidateQueries();
      router.refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex items-center justify-end gap-2">
      <Badge tone={SHIPMENT_STATUS_TONE[shipment.status]}>{SHIPMENT_STATUS_LABELS[shipment.status]}</Badge>
      <Select value={shipment.status} onValueChange={(v) => update.mutate(v as (typeof SHIPMENT_STATUSES)[number])} disabled={update.isPending}>
        <SelectTrigger className="h-8 w-40 text-xs">
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
  );
}

interface ItemRow {
  productName: string;
  sku: string;
  variant: string;
  quantity: string;
}

function CreateShipmentDialog({
  influencers,
  open,
  onOpenChange,
}: {
  influencers: CampaignInfluencerDTO[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [campaignInfluencerId, setCampaignInfluencerId] = React.useState('');
  const [deliverableId, setDeliverableId] = React.useState('');
  const [recipientName, setRecipientName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [addressLine1, setAddressLine1] = React.useState('');
  const [city, setCity] = React.useState('');
  const [country, setCountry] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [items, setItems] = React.useState<ItemRow[]>([{ productName: '', sku: '', variant: '', quantity: '1' }]);

  const selectedCi = influencers.find((ci) => ci.id === campaignInfluencerId);

  React.useEffect(() => {
    if (!open) return;
    setCampaignInfluencerId('');
    setDeliverableId('');
    setRecipientName('');
    setPhone('');
    setAddressLine1('');
    setCity('');
    setCountry('');
    setNotes('');
    setItems([{ productName: '', sku: '', variant: '', quantity: '1' }]);
  }, [open]);

  // Prefill recipient/phone from the selected creator's profile — still a
  // one-time copy into this shipment's own fields, not a live reference.
  React.useEffect(() => {
    if (selectedCi) {
      setRecipientName((prev) => prev || selectedCi.influencer.displayName);
    }
  }, [selectedCi]);

  function updateItem(i: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  const create = useMutation({
    mutationFn: () => {
      if (!campaignInfluencerId) throw new Error('Select a creator.');
      const cleanItems = items
        .filter((it) => it.productName.trim())
        .map((it) => ({
          productName: it.productName.trim(),
          sku: it.sku.trim() || undefined,
          variant: it.variant.trim() || undefined,
          quantity: Number(it.quantity) || 1,
        }));
      return api.campaignInfluencers.createShipment(campaignInfluencerId, {
        deliverableId: deliverableId || undefined,
        recipientName: recipientName.trim() || undefined,
        phone: phone.trim() || undefined,
        addressLine1: addressLine1.trim() || undefined,
        city: city.trim() || undefined,
        country: country.trim() || undefined,
        notes: notes.trim() || undefined,
        items: cleanItems,
      });
    },
    onSuccess: () => {
      toast.success('Shipment created.');
      queryClient.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create shipment</DialogTitle>
          <DialogDescription>A logistics fulfilment request — address is copied here, not linked live.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Creator">
            <Select
              value={campaignInfluencerId || NONE}
              onValueChange={(v) => {
                setCampaignInfluencerId(v === NONE ? '' : v);
                setDeliverableId('');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a creator on this campaign" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} disabled>
                  Choose a creator on this campaign
                </SelectItem>
                {influencers.map((ci) => (
                  <SelectItem key={ci.id} value={ci.id}>
                    {ci.influencer.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {selectedCi && selectedCi.deliverables.length > 0 ? (
            <Field label="Deliverable" hint="Optional — links this shipment to what it's for">
              <Select value={deliverableId || NONE} onValueChange={(v) => setDeliverableId(v === NONE ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Not tied to a specific deliverable" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not tied to a specific deliverable</SelectItem>
                  {selectedCi.deliverables.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {DELIVERABLE_TYPE_LABELS[d.type]} · {d.platform}
                      {d.requiresProduct ? ' (needs product)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Recipient">
              <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
            </Field>
            <Field label="Phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Address" className="col-span-2">
              <Input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
            </Field>
            <Field label="City">
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
            <Field label="Country">
              <Input value={country} onChange={(e) => setCountry(e.target.value)} />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Products</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setItems((prev) => [...prev, { productName: '', sku: '', variant: '', quantity: '1' }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add item
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] items-end gap-2">
                  <Field label={i === 0 ? 'Product' : undefined}>
                    <Input
                      value={item.productName}
                      onChange={(e) => updateItem(i, { productName: e.target.value })}
                      placeholder="e.g. Toner"
                    />
                  </Field>
                  <Field label={i === 0 ? 'SKU' : undefined}>
                    <Input value={item.sku} onChange={(e) => updateItem(i, { sku: e.target.value })} placeholder="Optional" />
                  </Field>
                  <Field label={i === 0 ? 'Qty' : undefined}>
                    <Input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateItem(i, { quantity: e.target.value })}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove item"
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <Field label="Notes" hint="Optional">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!campaignInfluencerId || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create shipment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
