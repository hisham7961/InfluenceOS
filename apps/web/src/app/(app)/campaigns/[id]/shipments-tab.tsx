'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, MessageSquare, Package, Plus, Trash2 } from 'lucide-react';
import type { CampaignInfluencerDTO, ProductShipmentDTO } from '@influenceos/contracts';
import { SHIPMENT_STATUSES, SHIPMENT_STATUS_TONE } from '@influenceos/shared';

// Tracking URLs are scheme-guarded on write; still gate the anchor to http(s).
const isHttpUrl = (u: string | null): u is string => !!u && /^https?:\/\//i.test(u);
const NONE = '__none__';

import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText, LtrText } from '@/components/common/bidi-text';
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
import { errorMessage } from '@/lib/errors';


/** Logistics fulfilment requests across a campaign roster (evolved W3-5 web
 *  surface): who a product went to, what it was, courier + tracking, and
 *  delivery status. One creator may have several — one per deliverable that
 *  needs a product, plus general gifts. Fully interactive: create + advance
 *  status here, the same rows the `/logistics` cross-campaign workspace reads. */
export function ShipmentsTab({ campaignId, influencers }: { campaignId: string; influencers: CampaignInfluencerDTO[] }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
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
    return (
      <EmptyState
        icon={Package}
        title={t('shipments.loadErrorTitle')}
        description={t('shipments.loadErrorDescription')}
      />
    );
  }

  const shipments = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> {t('shipments.createShipmentButton')}
        </Button>
      </div>

      {shipments.length === 0 ? (
        <EmptyState
          icon={Package}
          title={t('shipments.emptyTitle')}
          description={t('shipments.emptyDescription')}
        />
      ) : (
        <Card className="overflow-hidden">
          <TableScroll>
            <Table className="min-w-[860px]">
              <TableHead>
                <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                  <TableHeaderCell className="ps-5">{t('sourcing.creatorHeader')}</TableHeaderCell>
                  <TableHeaderCell>{t('shipments.productsHeader')}</TableHeaderCell>
                  <TableHeaderCell>{t('shipments.destinationHeader')}</TableHeaderCell>
                  <TableHeaderCell>{t('shipments.courierTrackingHeader')}</TableHeaderCell>
                  <TableHeaderCell align="end" className="pe-5">
                    {t('fields.status')}
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
                          <Avatar name={inf?.displayName ?? tCommon('unknown')} src={inf?.avatarUrl ?? undefined} size="xs" />
                          <span className="truncate font-medium">
                            {inf?.displayName ? <BidiText>{inf.displayName}</BidiText> : tCommon('unassigned')}
                          </span>
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
                              <LtrText>{s.trackingNumber}</LtrText> <ExternalLink className="size-3.5" aria-hidden />
                            </a>
                          ) : (
                            <LtrText>{s.trackingNumber}</LtrText>
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('workspace.deliverables.comments')}
                          onClick={() => setCommentsShipmentId(s.id)}
                        >
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
            <DialogTitle>{t('shipments.shipmentCommentsTitle')}</DialogTitle>
          </DialogHeader>
          {commentsShipmentId ? (
            <CommentThread
              context={{ shipmentId: commentsShipmentId }}
              cacheKey={`shipment:${commentsShipmentId}`}
              emptyTitle={t('workspace.deliverables.commentsEmptyTitle')}
              emptyDescription={t('shipments.commentsEmptyDescription')}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusCell({ shipment }: { shipment: ProductShipmentDTO }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (status: (typeof SHIPMENT_STATUSES)[number]) => api.shipments.updateStatus(shipment.id, { status }),
    onSuccess: () => {
      toast.success(t('shipments.statusUpdatedToast'));
      queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <div className="flex items-center justify-end gap-2">
      <Badge tone={SHIPMENT_STATUS_TONE[shipment.status]}>{enumLabel(tEnums, 'shipmentStatus', shipment.status)}</Badge>
      <Select value={shipment.status} onValueChange={(v) => update.mutate(v as (typeof SHIPMENT_STATUSES)[number])} disabled={update.isPending}>
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SHIPMENT_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {enumLabel(tEnums, 'shipmentStatus', s)}
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
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const queryClient = useQueryClient();
  const [campaignInfluencerId, setCampaignInfluencerId] = React.useState('');
  const [deliverableId, setDeliverableId] = React.useState('');
  const [recipientName, setRecipientName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [addressLine1, setAddressLine1] = React.useState('');
  const [addressLine2, setAddressLine2] = React.useState('');
  const [city, setCity] = React.useState('');
  const [country, setCountry] = React.useState('');
  const [postalCode, setPostalCode] = React.useState('');
  const [deliveryInstructions, setDeliveryInstructions] = React.useState('');
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
    setAddressLine2('');
    setCity('');
    setCountry('');
    setPostalCode('');
    setDeliveryInstructions('');
    setNotes('');
    setItems([{ productName: '', sku: '', variant: '', quantity: '1' }]);
  }, [open]);

  // Prefill recipient name from the roster row we already have (W3-5).
  React.useEffect(() => {
    if (selectedCi) {
      setRecipientName((prev) => prev || selectedCi.influencer.displayName);
    }
  }, [selectedCi]);

  // The roster row's InfluencerSummaryDTO doesn't carry the address/phone
  // fields, so once a creator is selected, fetch their full profile to
  // prefill the rest of the shipment's address from their own default
  // shipping address — still a one-time copy into this shipment's own
  // fields (see createDialogDescription below), never a live reference, so
  // the user can freely override any of it before submitting.
  const { data: selectedInfluencerDetail } = useQuery({
    queryKey: ['influencer-detail-for-shipment', selectedCi?.influencer.id],
    queryFn: () => api.influencers.get(selectedCi!.influencer.id),
    enabled: !!selectedCi,
  });

  React.useEffect(() => {
    if (!selectedInfluencerDetail) return;
    setPhone((prev) => prev || selectedInfluencerDetail.contact.mobile || '');
    setAddressLine1((prev) => prev || selectedInfluencerDetail.addressLine1 || '');
    setAddressLine2((prev) => prev || selectedInfluencerDetail.addressLine2 || '');
    setCity((prev) => prev || selectedInfluencerDetail.city || '');
    setCountry((prev) => prev || selectedInfluencerDetail.country || '');
    setPostalCode((prev) => prev || selectedInfluencerDetail.postalCode || '');
    setDeliveryInstructions((prev) => prev || selectedInfluencerDetail.deliveryInstructions || '');
  }, [selectedInfluencerDetail]);

  function updateItem(i: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  const create = useMutation({
    mutationFn: () => {
      if (!campaignInfluencerId) throw new Error(t('shipments.selectCreatorError'));
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
        addressLine2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        country: country.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        deliveryInstructions: deliveryInstructions.trim() || undefined,
        notes: notes.trim() || undefined,
        items: cleanItems,
      });
    },
    onSuccess: () => {
      toast.success(t('shipments.createdToast'));
      queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('shipments.createShipmentButton')}</DialogTitle>
          <DialogDescription>{t('shipments.createDialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t('shipments.creatorFieldLabel')}>
            <Select
              value={campaignInfluencerId || NONE}
              onValueChange={(v) => {
                setCampaignInfluencerId(v === NONE ? '' : v);
                setDeliverableId('');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('shipments.selectCreatorPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} disabled>
                  {t('shipments.selectCreatorPlaceholder')}
                </SelectItem>
                {influencers.map((ci) => (
                  <SelectItem key={ci.id} value={ci.id}>
                    <BidiText>{ci.influencer.displayName}</BidiText>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {selectedCi && selectedCi.deliverables.length > 0 ? (
            <Field label={t('submissions.deliverableHeader')} hint={t('shipments.deliverableFieldHint')}>
              <Select value={deliverableId || NONE} onValueChange={(v) => setDeliverableId(v === NONE ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('shipments.notTiedPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('shipments.notTiedPlaceholder')}</SelectItem>
                  {selectedCi.deliverables.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {enumLabel(tEnums, 'deliverableType', d.type)} · {d.platform}
                      {d.requiresProduct ? t('shipments.needsProductSuffix') : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <Field label={t('shipments.recipientLabel')}>
              <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
            </Field>
            <Field label={t('shipments.phoneLabel')}>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label={t('shipments.addressLabel')} className="col-span-2">
              <Input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
            </Field>
            <Field label={t('shipments.addressLine2Label')} hint={t('fields.optionalHint')} className="col-span-2">
              <Input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
            </Field>
            <Field label={t('shipments.cityLabel')}>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
            <Field label={t('shipments.countryLabel')}>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} />
            </Field>
            <Field label={t('shipments.postalCodeLabel')} hint={t('fields.optionalHint')}>
              <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </Field>
          </div>

          <Field label={t('shipments.deliveryInstructionsLabel')} hint={t('fields.optionalHint')}>
            <Textarea value={deliveryInstructions} onChange={(e) => setDeliveryInstructions(e.target.value)} rows={2} />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('shipments.productsHeader')}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setItems((prev) => [...prev, { productName: '', sku: '', variant: '', quantity: '1' }])}
              >
                <Plus className="h-3.5 w-3.5" /> {t('shipments.addItemButton')}
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] items-end gap-2">
                  <Field label={i === 0 ? t('shipments.productFieldLabel') : undefined}>
                    <Input
                      value={item.productName}
                      onChange={(e) => updateItem(i, { productName: e.target.value })}
                      placeholder={t('shipments.productPlaceholder')}
                    />
                  </Field>
                  <Field label={i === 0 ? t('shipments.skuFieldLabel') : undefined}>
                    <Input
                      value={item.sku}
                      onChange={(e) => updateItem(i, { sku: e.target.value })}
                      placeholder={t('fields.optionalHint')}
                    />
                  </Field>
                  <Field label={i === 0 ? t('fields.quantity') : undefined}>
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
                    aria-label={t('shipments.removeItemAriaLabel')}
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <Field label={t('fields.notes')} hint={t('fields.optionalHint')}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={!campaignInfluencerId || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? t('shipments.creating') : t('shipments.createShipmentButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
