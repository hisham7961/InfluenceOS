'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Megaphone, UserPlus, UserSearch } from 'lucide-react';
import type { BulkPreviewDTO, DealType } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { DEAL_TYPES } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { cn } from '@/lib/cn';
import { BidiText } from '@/components/common/bidi-text';
import { EntityCombobox } from '@/components/common/entity-combobox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/errors';

type Mode = 'roster' | 'shortlist';


/**
 * Put one or more creators on a campaign without opening it first — from the
 * directory's bulk bar, a creator's page or the directory preview. Either
 * straight onto the roster (with the deal type and fee, after a preview of
 * who will be added and who is already there) or onto the campaign's
 * shortlist for a decision later.
 */
export function AddToCampaignDialog({
  influencers,
  open,
  onOpenChange,
  onDone,
}: {
  influencers: { id: string; displayName: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const t = useTranslations('campaigns.addToCampaign');
  const tFields = useTranslations('campaigns.fields');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [campaignId, setCampaignId] = React.useState('');
  const [mode, setMode] = React.useState<Mode>('roster');
  const [dealType, setDealType] = React.useState<DealType>('PAID');
  const [fee, setFee] = React.useState('');
  const [preview, setPreview] = React.useState<BulkPreviewDTO | null>(null);

  React.useEffect(() => {
    if (open) {
      setCampaignId('');
      setMode('roster');
      setDealType('PAID');
      setFee('');
      setPreview(null);
    }
  }, [open]);

  const paid = dealType === 'PAID' || dealType === 'PAID_PLUS_GIFTED';
  const feeNumber = fee.trim() ? Number(fee.replace(/,/g, '')) : null;
  const feeInvalid = paid && feeNumber != null && (!Number.isFinite(feeNumber) || feeNumber < 0);
  const count = influencers.length;
  const single = count === 1 ? influencers[0]! : null;

  const rows = () =>
    influencers.map((i) => ({ influencerId: i.id, dealType, agreedCost: paid && feeNumber != null ? feeNumber : undefined }));

  function finish(tab: 'influencers' | 'sourcing', message: string) {
    toast.success(message, {
      action: { label: t('openCampaign'), onClick: () => router.push(`/campaigns/${campaignId}?tab=${tab}`) },
    });
    queryClient.invalidateQueries();
    router.refresh();
    onDone?.();
    onOpenChange(false);
  }

  const previewRoster = useMutation({
    mutationFn: () => api.campaigns.previewRosterAdd(campaignId, { rows: rows() }),
    onSuccess: setPreview,
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const addRoster = useMutation({
    mutationFn: () => api.campaigns.addRosterInfluencers(campaignId, { rows: rows() }),
    onSuccess: (res) =>
      finish('influencers', t('addedToRosterToast', { added: res.added, skipped: res.skipped + res.failed })),
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const shortlist = useMutation({
    mutationFn: async () => {
      let added = 0;
      let skipped = 0;
      for (const i of influencers) {
        try {
          await api.campaigns.addCandidate(campaignId, { influencerId: i.id });
          added += 1;
        } catch (e) {
          // Already a candidate on this campaign: nothing to do for this one.
          if (e instanceof ApiError && e.status === 409) skipped += 1;
          else throw e;
        }
      }
      return { added, skipped };
    },
    onSuccess: (res) => finish('sourcing', t('shortlistedToast', res)),
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const busy = previewRoster.isPending || addRoster.isPending || shortlist.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {single ? t('titleOne', { name: single.displayName }) : t('titleMany', { count })}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {preview ? (
          <div className="min-w-0 space-y-3">
            <p className="text-sm">
              {t('previewSummary', { willAdd: preview.willUpdate, willSkip: preview.willSkip })}
            </p>
            <ul className="max-h-60 min-w-0 space-y-1 overflow-y-auto rounded-xl border border-border p-2 text-sm">
              {preview.rows.map((r, idx) => (
                <li key={r.influencerId ?? idx} className="flex min-w-0 items-center justify-between gap-2 px-1 py-0.5">
                  <BidiText className="min-w-0 flex-1 truncate">
                    {r.label ?? influencers.find((i) => i.id === r.influencerId)?.displayName ?? '—'}
                  </BidiText>
                  {r.status === 'added' ? (
                    <Badge tone="success">{t('rowWillAdd')}</Badge>
                  ) : (
                    <span className="min-w-0 max-w-[55%] truncate text-xs text-muted-foreground" title={r.message ?? undefined}>
                      {r.message ?? t('rowSkipped')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label={t('campaignLabel')}>
              <EntityCombobox
                kind="campaign"
                value={campaignId}
                onChange={(id) => setCampaignId(id)}
                placeholder={t('campaignPlaceholder')}
                aria-label={t('campaignLabel')}
              />
            </Field>

            <div role="radiogroup" aria-label={t('modeLabel')} className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { value: 'roster', icon: UserPlus, title: t('modeRoster'), hint: t('modeRosterHint') },
                  { value: 'shortlist', icon: UserSearch, title: t('modeShortlist'), hint: t('modeShortlistHint') },
                ] as const
              ).map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  onClick={() => setMode(m.value)}
                  className={cn(
                    'flex items-start gap-2.5 rounded-xl border p-3 text-start transition-colors',
                    mode === m.value ? 'border-brand bg-brand-soft/40' : 'border-border hover:bg-surface-muted',
                  )}
                >
                  <m.icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <span className="block text-sm font-medium">{m.title}</span>
                    <span className="block text-xs text-muted-foreground">{m.hint}</span>
                  </span>
                </button>
              ))}
            </div>

            {mode === 'roster' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={tFields('dealType')}>
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
                {paid ? (
                  <Field
                    label={count > 1 ? t('feeEach') : t('fee')}
                    hint={tFields('optionalHint')}
                    error={feeInvalid ? t('feeInvalid') : undefined}
                  >
                    <Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.000" />
                  </Field>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {preview ? (
            <>
              <Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>
                {tCommon('back')}
              </Button>
              <Button disabled={busy || preview.willUpdate === 0} onClick={() => addRoster.mutate()}>
                <UserPlus className="h-4 w-4" /> {t('confirmAdd', { count: preview.willUpdate })}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon('cancel')}
              </Button>
              <Button
                disabled={!campaignId || feeInvalid || busy}
                onClick={() => (mode === 'roster' ? previewRoster.mutate() : shortlist.mutate())}
              >
                <Megaphone className="h-4 w-4" /> {mode === 'roster' ? t('reviewButton') : t('shortlistButton')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A button that opens {@link AddToCampaignDialog} for one creator. */
export function AddToCampaignButton({
  influencer,
  variant = 'outline',
  className,
}: {
  influencer: { id: string; displayName: string };
  variant?: 'outline' | 'default' | 'secondary';
  className?: string;
}) {
  const t = useTranslations('campaigns.addToCampaign');
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" size="sm" variant={variant} className={className} onClick={() => setOpen(true)}>
        <Megaphone className="h-3.5 w-3.5" /> {t('trigger')}
      </Button>
      <AddToCampaignDialog influencers={[influencer]} open={open} onOpenChange={setOpen} />
    </>
  );
}
