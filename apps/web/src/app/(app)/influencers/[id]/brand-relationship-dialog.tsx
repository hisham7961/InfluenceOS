'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BrandInfluencerDTO, Priority, RelationshipStatus } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { PRIORITIES, RELATIONSHIP_STATUSES } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { useApp } from '@/components/shell/app-context';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/**
 * The creator's standing with one brand: status, priority, their usual rate
 * for that brand and private notes. Pass `relationship` to edit one; without
 * it, pick the brand to start a new one. Collaboration counts are worked out
 * from campaigns and can't be typed in.
 */
export function BrandRelationshipDialog({
  influencerId,
  relationship,
  existingBrandIds,
  open,
  onOpenChange,
}: {
  influencerId: string;
  relationship?: BrandInfluencerDTO | null;
  existingBrandIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('influencers.detail.brands');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { brands } = useApp();
  const [brandId, setBrandId] = React.useState('');
  const [status, setStatus] = React.useState<RelationshipStatus>('PROSPECT');
  const [priority, setPriority] = React.useState<Priority>('MEDIUM');
  const [rate, setRate] = React.useState('');
  const [currency, setCurrency] = React.useState('KWD');
  const [notes, setNotes] = React.useState('');
  const [active, setActive] = React.useState(true);
  const [removeOpen, setRemoveOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setBrandId(relationship?.brand.id ?? '');
    setStatus(relationship?.relationshipStatus ?? 'PROSPECT');
    setPriority(relationship?.priority ?? 'MEDIUM');
    setRate(relationship?.defaultRate != null ? String(relationship.defaultRate) : '');
    setCurrency(relationship?.currency ?? 'KWD');
    setNotes(relationship?.internalNotes ?? '');
    setActive(relationship?.isActive ?? true);
  }, [open, relationship]);

  const rateNumber = rate.trim() ? Number(rate.replace(/,/g, '')) : null;
  const rateInvalid = rateNumber != null && (!Number.isFinite(rateNumber) || rateNumber < 0);
  const available = brands.filter((b) => !existingBrandIds.includes(b.id));

  const refresh = () => {
    queryClient.invalidateQueries();
    router.refresh();
  };
  const save = useMutation({
    mutationFn: () =>
      api.brandInfluencers.upsert({
        brandId,
        influencerId,
        relationshipStatus: status,
        priority,
        defaultRate: rateNumber,
        currency: currency.trim() || null,
        internalNotes: notes.trim() || null,
        isActive: active,
      }),
    onSuccess: () => {
      toast.success(t('savedToast'));
      refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const remove = useMutation({
    mutationFn: () => api.brandInfluencers.remove(relationship!.id),
    onSuccess: () => {
      toast.success(t('removedToast'));
      setRemoveOpen(false);
      refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{relationship ? t('editTitle', { brand: relationship.brand.name }) : t('addTitle')}</DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {relationship ? null : (
            <Field label={t('brandLabel')} className="sm:col-span-2">
              <Select value={brandId || undefined} onValueChange={setBrandId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('pickBrand')} />
                </SelectTrigger>
                <SelectContent>
                  {available.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t('statusLabel')}>
            <Select value={status} onValueChange={(v) => setStatus(v as RelationshipStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIONSHIP_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {enumLabel(tEnums, 'relationshipStatus', s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('priorityLabel')}>
            <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {enumLabel(tEnums, 'priority', p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('defaultRate')} error={rateInvalid ? t('rateInvalid') : undefined}>
            <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.000" />
          </Field>
          <Field label={t('currencyLabel')}>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={8} dir="ltr" />
          </Field>
          <Field label={t('notesLabel')} className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('notesPlaceholder')} />
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm sm:col-span-2">
            {t('activeLabel')}
            <Switch checked={active} onCheckedChange={setActive} aria-label={t('activeLabel')} />
          </label>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {relationship ? (
            <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => setRemoveOpen(true)}>
              {t('removeButton')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button disabled={!brandId || rateInvalid || save.isPending} onClick={() => save.mutate()}>
              {tCommon('save')}
            </Button>
          </div>
        </DialogFooter>
        {relationship ? (
          <ConfirmDialog
            open={removeOpen}
            onOpenChange={setRemoveOpen}
            title={t('removeTitle', { brand: relationship.brand.name })}
            description={t('removeDescription')}
            confirmLabel={t('removeButton')}
            loading={remove.isPending}
            onConfirm={() => remove.mutate()}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
