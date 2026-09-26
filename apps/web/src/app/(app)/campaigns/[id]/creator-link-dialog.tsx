'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, ListChecks } from 'lucide-react';
import type { CampaignDetailDTO, CampaignInfluencerDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { useLocalizedFormat } from '@/lib/format';
import { WhatsAppDialog } from '@/components/influencers/whatsapp-dialog';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

const EXPIRY = ['30', '90', '180', 'never'] as const;
type Expiry = (typeof EXPIRY)[number];

/**
 * A creator's task link (P3.3), from their roster row: make it, copy it or
 * send it on WhatsApp with the brief, see whether they opened it, turn it
 * off. The creator sees the brief, their tasks and the approved script,
 * sends drafts and the live post link, and reads the team's feedback — never
 * fees or internal notes.
 */
export function CreatorLinkButton({ ci, campaign }: { ci: CampaignInfluencerDTO; campaign: CampaignDetailDTO }) {
  const t = useTranslations('campaigns.creatorLink');
  const [open, setOpen] = React.useState(false);
  const label = t('buttonAria', { name: ci.influencer.displayName });
  return (
    <>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={() => setOpen(true)}>
        <ListChecks className="h-4 w-4" />
      </Button>
      {open ? <CreatorLinkDialog ci={ci} campaign={campaign} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function CreatorLinkDialog({ ci, campaign, onClose }: { ci: CampaignInfluencerDTO; campaign: CampaignDetailDTO; onClose: () => void }) {
  const t = useTranslations('campaigns.creatorLink');
  const tCommon = useTranslations('common');
  const f = useLocalizedFormat();
  const queryClient = useQueryClient();
  const key = qk.campaign.creatorLinks(campaign.id, ci.id);
  const [lang, setLang] = React.useState<'en' | 'ar'>('ar');
  const [expiry, setExpiry] = React.useState<Expiry>('90');
  const [confirmOff, setConfirmOff] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const name = ci.influencer.displayName;

  const links = useQuery({ queryKey: key, queryFn: () => api.creatorLinks.list(ci.id) });
  const active = links.data?.find((l) => l.active && l.path) ?? null;
  const url = active ? `${window.location.origin}${active.path}` : null;

  const create = useMutation({
    mutationFn: () =>
      api.creatorLinks.create(ci.id, { locale: lang, expiresInDays: expiry === 'never' ? null : Number(expiry) }),
    onSuccess: () => {
      toast.success(t('created'));
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.creatorLinks.revoke(id),
    onSuccess: () => {
      toast.success(t('turnedOff'));
      setConfirmOff(false);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t('copied'));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is still selectable */
    }
  }

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title', { name })}</DialogTitle>
          <DialogDescription>{t('description', { name })}</DialogDescription>
        </DialogHeader>

        {links.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : active && url ? (
          <div className="space-y-3">
            <div className="border-border bg-muted/40 flex items-center gap-2 rounded-lg border p-2">
              <input
                readOnly
                dir="ltr"
                value={url}
                aria-label={t('linkLabel')}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 bg-transparent text-xs outline-none"
              />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t('copy')} title={t('copy')} onClick={copy}>
                {copied ? <Check className="text-success h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              {active.locale === 'ar' ? 'العربية' : 'English'} ·{' '}
              {active.expiresAt ? t('expiresOn', { date: f.shortDate(active.expiresAt) }) : t('noEnd')} ·{' '}
              {active.openCount > 0
                ? t('opened', { n: active.openCount, date: f.relativeTime(active.lastOpenedAt) })
                : t('notOpened')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <WhatsAppDialog
                variant="outline"
                influencerId={ci.influencer.id}
                creatorName={name}
                purpose="BRIEF"
                campaignInfluencerId={ci.id}
                context={{
                  campaignName: campaign.name,
                  brandName: campaign.brand.name,
                  deliverables: ci.deliverables
                    .filter((d) => d.status !== 'CANCELLED')
                    .map((d) => ({ type: d.type, platform: d.platform, dueDate: d.dueDate })),
                  taskLinkUrl: url,
                }}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmOff(true)}>
                {t('turnOff')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('language')}>
                <Select value={lang} onValueChange={(v) => setLang(v as 'en' | 'ar')}>
                  <SelectTrigger aria-label={t('language')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ar">العربية</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('expires')}>
                <Select value={expiry} onValueChange={(v) => setExpiry(v as Expiry)}>
                  <SelectTrigger aria-label={t('expires')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY.map((e) => (
                      <SelectItem key={e} value={e}>
                        {e === 'never' ? t('never') : t('days', { n: Number(e) })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {links.data?.some((l) => !l.active) ? <p className="text-muted-foreground text-xs">{t('oldLinksOff')}</p> : null}
            <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending}>
              <ListChecks className="h-4 w-4" /> {t('create')}
            </Button>
          </div>
        )}
      </DialogContent>
      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title={t('turnOffTitle')}
        description={t('turnOffBody', { name })}
        confirmLabel={t('turnOff')}
        loading={revoke.isPending}
        onConfirm={() => active && revoke.mutate(active.id)}
      />
    </Dialog>
  );
}
