'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarPlus, MoreHorizontal, Pencil, ShieldCheck, ShieldOff } from 'lucide-react';
import type { UsageRightDTO, UsageRightType } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { USAGE_RIGHT_TYPES } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { EntityCombobox } from '@/components/common/entity-combobox';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/** ISO → yyyy-mm-dd (local day) for a date input. */
function dayValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const toDate = (v: string) => (v ? new Date(`${v}T12:00:00`) : null);

export interface UsageRightDefaults {
  influencerId?: string | null;
  influencerName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  publishedContentId?: string | null;
}

/**
 * Record a content licence for a brand, or edit one (pass `right`): how the
 * brand may use the content (organic, paid ads, whitelisting…), where, for
 * how long, and on what terms. Extending a licence is editing its end date.
 * `defaults` pre-fills the creator, campaign and post when recorded from a
 * post.
 */
export function UsageRightDialog({
  brandId,
  right,
  defaults,
  open,
  onOpenChange,
}: {
  brandId: string;
  right?: UsageRightDTO | null;
  defaults?: UsageRightDefaults;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('brands.usageRights');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [usageType, setUsageType] = React.useState<UsageRightType>('ORGANIC');
  const [influencerId, setInfluencerId] = React.useState('');
  const [campaignId, setCampaignId] = React.useState('');
  const [scope, setScope] = React.useState('');
  const [territory, setTerritory] = React.useState('');
  const [startsAt, setStartsAt] = React.useState('');
  const [expiresAt, setExpiresAt] = React.useState('');
  const [exclusive, setExclusive] = React.useState(false);
  const [disclosure, setDisclosure] = React.useState(false);
  const [competitor, setCompetitor] = React.useState('');
  const [notes, setNotes] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setUsageType(right?.usageType ?? 'ORGANIC');
    setInfluencerId(right?.influencerId ?? defaults?.influencerId ?? '');
    setCampaignId(right?.campaignId ?? defaults?.campaignId ?? '');
    setScope(right?.scope ?? '');
    setTerritory(right?.territory ?? '');
    setStartsAt(dayValue(right?.startsAt));
    setExpiresAt(dayValue(right?.expiresAt));
    setExclusive(right?.exclusive ?? false);
    setDisclosure(right?.disclosureRequired ?? false);
    setCompetitor(right?.competitorRestriction ?? '');
    setNotes(right?.notes ?? '');
    // Reset only when the dialog opens (or switches licence) — `defaults` is a
    // fresh object on every parent render and must not wipe what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, right?.id]);

  const endsBeforeStart = !!startsAt && !!expiresAt && expiresAt < startsAt;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        usageType,
        influencerId: influencerId || null,
        campaignId: campaignId || null,
        scope: scope.trim() || null,
        territory: territory.trim() || null,
        startsAt: toDate(startsAt),
        expiresAt: toDate(expiresAt),
        exclusive,
        disclosureRequired: disclosure,
        competitorRestriction: competitor.trim() || null,
        notes: notes.trim() || null,
      };
      return right
        ? api.usageRights.update(right.id, body)
        : api.brands.createUsageRight(brandId, { ...body, publishedContentId: defaults?.publishedContentId ?? null });
    },
    onSuccess: () => {
      toast.success(right ? t('savedToast') : t('recordedToast'));
      queryClient.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{right ? t('editTitle') : t('recordTitle')}</DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('typeColumn')}>
            <Select value={usageType} onValueChange={(v) => setUsageType(v as UsageRightType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USAGE_RIGHT_TYPES.map((u) => (
                  <SelectItem key={u} value={u}>
                    {enumLabel(tEnums, 'usageRightType', u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('creatorColumn')} hint={t('optional')}>
            <EntityCombobox
              kind="influencer"
              value={influencerId}
              valueLabel={right?.influencerName ?? defaults?.influencerName ?? null}
              onChange={(id) => setInfluencerId(id)}
              placeholder={t('pickCreator')}
              noneLabel={t('anyCreator')}
              aria-label={t('creatorColumn')}
            />
          </Field>
          <Field label={t('campaignLabel')} hint={t('optional')} className="sm:col-span-2">
            <EntityCombobox
              kind="campaign"
              value={campaignId}
              valueLabel={right?.campaignName ?? defaults?.campaignName ?? null}
              onChange={(id) => setCampaignId(id)}
              brandId={brandId}
              placeholder={t('pickCampaign')}
              noneLabel={t('anyCampaign')}
              aria-label={t('campaignLabel')}
            />
          </Field>
          <Field label={t('scopeLabel')} hint={t('scopeHint')}>
            <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder={t('scopePlaceholder')} />
          </Field>
          <Field label={t('territoryLabel')}>
            <Input value={territory} onChange={(e) => setTerritory(e.target.value)} placeholder={t('territoryPlaceholder')} />
          </Field>
          <Field label={t('startsLabel')} hint={t('optional')}>
            <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label={t('expiresColumn')} hint={t('expiresHint')} error={endsBeforeStart ? t('endsBeforeStart') : undefined}>
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm">
            {t('exclusive')}
            <Switch checked={exclusive} onCheckedChange={setExclusive} aria-label={t('exclusive')} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm">
            {t('disclosureLabel')}
            <Switch checked={disclosure} onCheckedChange={setDisclosure} aria-label={t('disclosureLabel')} />
          </label>
          <Field label={t('competitorLabel')} hint={t('optional')} className="sm:col-span-2">
            <Input value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder={t('competitorPlaceholder')} />
          </Field>
          <Field label={t('notesLabel')} hint={t('optional')} className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={endsBeforeStart || save.isPending} onClick={() => save.mutate()}>
            {right ? tCommon('save') : t('recordButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Record usage rights" for the brand's usage-rights card. */
export function RecordUsageRightButton({ brandId }: { brandId: string }) {
  const t = useTranslations('brands.usageRights');
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <ShieldCheck className="h-4 w-4" /> {t('recordButton')}
      </Button>
      <UsageRightDialog brandId={brandId} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Edit, extend or revoke one licence. */
export function UsageRightRowActions({ right }: { right: UsageRightDTO }) {
  const t = useTranslations('brands.usageRights');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = React.useState(false);
  const [revokeOpen, setRevokeOpen] = React.useState(false);
  const revoked = right.status === 'REVOKED';

  const refresh = () => {
    queryClient.invalidateQueries();
    router.refresh();
  };
  // Extend from the current end date (or today, if it already ended).
  const extend = useMutation({
    mutationFn: (days: number) => {
      const base = right.expiresAt && new Date(right.expiresAt) > new Date() ? new Date(right.expiresAt) : new Date();
      base.setDate(base.getDate() + days);
      return api.usageRights.update(right.id, { expiresAt: base });
    },
    onSuccess: () => {
      toast.success(t('extendedToast'));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const revoke = useMutation({
    mutationFn: () => api.brands.revokeUsageRight(right.id),
    onSuccess: () => {
      toast.success(t('revokedToast'));
      setRevokeOpen(false);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t('actionsLabel')}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" /> {t('editAction')}
          </DropdownMenuItem>
          {revoked ? null : (
            <>
              <DropdownMenuItem onSelect={() => extend.mutate(30)}>
                <CalendarPlus className="h-4 w-4" /> {t('extendBy', { days: 30 })}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => extend.mutate(90)}>
                <CalendarPlus className="h-4 w-4" /> {t('extendBy', { days: 90 })}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRevokeOpen(true)} className="text-danger">
                <ShieldOff className="h-4 w-4" /> {t('revokeAction')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <UsageRightDialog brandId={right.brandId} right={right} open={editOpen} onOpenChange={setEditOpen} />
      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title={t('revokeTitle')}
        description={t('revokeDescription')}
        confirmLabel={t('revokeAction')}
        loading={revoke.isPending}
        onConfirm={() => revoke.mutate()}
      />
    </>
  );
}
