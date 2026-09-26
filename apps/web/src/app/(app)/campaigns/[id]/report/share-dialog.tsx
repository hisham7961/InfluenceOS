'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, Link2 } from 'lucide-react';
import type { ReportShareDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { useLocalizedFormat } from '@/lib/format';
import { useApp } from '@/components/shell/app-context';
import { LtrText } from '@/components/common/bidi-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

const EXPIRY = ['7', '30', '90', 'never'] as const;
type Expiry = (typeof EXPIRY)[number];

function fullUrl(path: string): string {
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // clipboard blocked — the link is still selectable
  }
}

/**
 * Share the client report by link (P3.3): the brand's team opens it without
 * an account. The link fixes the language and whether costs show; it can
 * expire and be turned off, and shows how often it was opened.
 */
export function ShareReportButton({ campaignId, locale }: { campaignId: string; locale: 'en' | 'ar' }) {
  const t = useTranslations('campaigns.clientReport.share');
  const { can } = useApp();
  const [open, setOpen] = React.useState(false);
  if (!can('CAMPAIGNS_MANAGE')) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Link2 className="h-4 w-4" /> {t('button')}
      </Button>
      {open ? <ShareDialog campaignId={campaignId} locale={locale} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ShareDialog({ campaignId, locale, onClose }: { campaignId: string; locale: 'en' | 'ar'; onClose: () => void }) {
  const t = useTranslations('campaigns.clientReport.share');
  const tCommon = useTranslations('common');
  const { can } = useApp();
  const queryClient = useQueryClient();
  const canCosts = can('FINANCE_VIEW');
  const [lang, setLang] = React.useState<'en' | 'ar'>(locale);
  const [costs, setCosts] = React.useState(false);
  const [expiry, setExpiry] = React.useState<Expiry>('30');
  const [fresh, setFresh] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<ReportShareDTO | null>(null);

  const list = useQuery({
    queryKey: qk.campaign.reportShares(campaignId),
    queryFn: () => api.campaigns.reportShares(campaignId),
  });

  const create = useMutation({
    mutationFn: () =>
      api.campaigns.shareReport(campaignId, {
        locale: lang,
        includeCosts: canCosts && costs,
        expiresInDays: expiry === 'never' ? null : Number(expiry),
      }),
    onSuccess: async (share) => {
      const url = fullUrl(share.path);
      setFresh(url);
      toast.success((await copy(url)) ? t('createdCopied') : t('created'));
      void queryClient.invalidateQueries({ queryKey: qk.campaign.reportShares(campaignId) });
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.campaigns.revokeReportShare(id),
    onSuccess: () => {
      toast.success(t('turnedOff'));
      setRevoking(null);
      void queryClient.invalidateQueries({ queryKey: qk.campaign.reportShares(campaignId) });
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('language')}>
              <Select value={lang} onValueChange={(v) => setLang(v as 'en' | 'ar')}>
                <SelectTrigger aria-label={t('language')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
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
          <label className="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
            <span>
              {t('includeCosts')}
              <span className="text-muted-foreground block text-xs">
                {canCosts ? t('includeCostsHint') : t('costsNotAllowed')}
              </span>
            </span>
            <Switch checked={canCosts && costs} disabled={!canCosts} onCheckedChange={setCosts} aria-label={t('includeCosts')} />
          </label>
          <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending}>
            <Link2 className="h-4 w-4" /> {t('create')}
          </Button>
          {fresh ? (
            <div className="border-border bg-muted/40 flex items-center gap-2 rounded-lg border p-2">
              <input
                readOnly
                dir="ltr"
                value={fresh}
                aria-label={t('newLink')}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 bg-transparent text-xs outline-none"
              />
              <CopyButton url={fresh} />
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('existing')}</h3>
          {list.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : !list.data?.length ? (
            <p className="text-muted-foreground text-sm">{t('none')}</p>
          ) : (
            <ul className="divide-border max-h-72 divide-y overflow-y-auto">
              {/* Working links first, newest first within each group. */}
              {[...list.data].sort((a, b) => Number(b.active) - Number(a.active)).map((s) => (
                <ShareRow key={s.id} share={s} onRevoke={() => setRevoking(s)} />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(v) => (!v ? setRevoking(null) : undefined)}
        title={t('turnOffTitle')}
        description={t('turnOffBody')}
        confirmLabel={t('turnOff')}
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </Dialog>
  );
}

function ShareRow({ share: s, onRevoke }: { share: ReportShareDTO; onRevoke: () => void }) {
  const t = useTranslations('campaigns.clientReport.share');
  const f = useLocalizedFormat();
  const state = s.revokedAt ? t('stateOff') : !s.active ? t('stateExpired') : null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{s.locale === 'ar' ? 'العربية' : 'English'}</Badge>
          {s.includeCosts ? <Badge tone="warning">{t('withCosts')}</Badge> : null}
          {state ? <Badge tone="danger">{state}</Badge> : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {s.active
            ? s.expiresAt
              ? t('expiresOn', { date: f.shortDate(s.expiresAt) })
              : t('noEnd')
            : null}
          {s.active ? ' · ' : null}
          {s.viewCount > 0
            ? t('views', { n: s.viewCount, date: f.relativeTime(s.lastViewedAt) })
            : t('notOpened')}
        </p>
        <p className="text-muted-foreground text-xs">
          {t('createdBy', { name: s.createdByName ?? '—', date: f.shortDate(s.createdAt) })}
        </p>
      </div>
      {s.active ? (
        <div className="flex items-center gap-1">
          {s.path ? <CopyButton url={fullUrl(s.path)} /> : null}
          <Button variant="ghost" size="sm" onClick={onRevoke}>
            {t('turnOff')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function CopyButton({ url }: { url: string }) {
  const t = useTranslations('campaigns.clientReport.share');
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t('copy')}
      title={t('copy')}
      onClick={async () => {
        if (await copy(url)) {
          setCopied(true);
          toast.success(t('copied'));
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? <Check className="text-success h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span className="sr-only">
        <LtrText>{url}</LtrText>
      </span>
    </Button>
  );
}
