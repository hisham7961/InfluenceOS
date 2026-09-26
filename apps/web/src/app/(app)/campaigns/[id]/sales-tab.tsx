'use client';

import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, FileUp, Link2, Plus, ShoppingBag, Tag, Trash2, Undo2 } from 'lucide-react';
import type {
  CampaignDetailDTO,
  CampaignInfluencerDTO,
  CampaignSalesDTO,
  CurrencyTotalDTO,
  SalesImportResultDTO,
} from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { formatCurrency, formatNumber, formatPercent, useLocalizedFormat } from '@/lib/format';
import { MAX_SALE_ROWS, SALE_FIELDS, guessColumns, readSalesTable, toImportRows, type ColumnMap, type SaleField, type SalesTable } from '@/lib/sales-columns';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';

/**
 * Sales & ROI (P3.1): the campaign's promo codes and tracking links, the
 * brand's sales credited to each creator, and — with finance access — the
 * return on spend. Nothing here is estimated: sales come from the brand's
 * shop file or are entered by hand.
 */

const NONE = '__none__';
const CURRENCIES = ['KWD', 'SAR', 'AED', 'QAR', 'BHD', 'OMR', 'USD', 'EUR'];

function useMoney() {
  const locale = useLocale();
  return (list: CurrencyTotalDTO[]) =>
    list.length ? list.map((m) => formatCurrency(m.amount, m.currency, locale).replace(/ /g, ' ')).join(' · ') : '—';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SalesTab({ campaign, influencers }: { campaign: CampaignDetailDTO; influencers: CampaignInfluencerDTO[] }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const sales = useQuery({ queryKey: qk.campaign.sales(campaign.id), queryFn: () => api.sales.forCampaign(campaign.id) });

  if (sales.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (!sales.data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-6 text-sm">
          <span className="text-muted-foreground">{t('workspace.sales.loadError')}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => sales.refetch()}>
            {tCommon('retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }
  const s = sales.data;
  const empty = s.promoCodes.length === 0 && s.links.length === 0 && s.recentSales.length === 0;

  return (
    <div className="space-y-6">
      <Summary s={s} />
      {empty ? (
        <Card>
          <CardContent className="p-2">
            <EmptyState icon={ShoppingBag} title={t('workspace.sales.emptyTitle')} description={t('workspace.sales.emptyDescription')} />
          </CardContent>
        </Card>
      ) : (
        <Creators s={s} />
      )}
      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <PromoCodes s={s} campaign={campaign} influencers={influencers} />
        <TrackingLinks s={s} campaign={campaign} influencers={influencers} />
      </div>
      <Sales s={s} campaign={campaign} influencers={influencers} />
    </div>
  );
}

function Summary({ s }: { s: CampaignSalesDTO }) {
  const t = useTranslations('campaigns');
  const locale = useLocale();
  const money = useMoney();
  const inCurrency = s.revenue.find((r) => r.currency === s.currency);
  const others = s.revenue.filter((r) => r.currency !== s.currency);
  const finance = s.spend !== null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t('workspace.sales.orders')} value={s.orders} icon={ShoppingBag} />
        <StatCard
          label={t('workspace.sales.revenue')}
          value={inCurrency?.amount ?? 0}
          formatted={money(inCurrency ? [inCurrency] : [{ currency: s.currency, amount: 0 }])}
          icon={Tag}
        />
        <StatCard
          label={t('workspace.sales.clicks')}
          value={s.clicks}
          icon={Link2}
          hint={s.conversionRate !== null ? t('workspace.sales.conversionHint', { rate: formatPercent(s.conversionRate * 100, 1, locale) }) : undefined}
        />
        {finance ? (
          <StatCard
            label={t('workspace.sales.roas')}
            value={s.roas}
            formatted={s.roas !== null ? `${formatNumber(s.roas, locale)}×` : '—'}
            hint={
              s.costPerOrder !== null
                ? t('workspace.sales.costPerOrderHint', { amount: formatCurrency(s.costPerOrder, s.currency, locale).replace(/ /g, ' ') })
                : t('workspace.sales.roasNoSales')
            }
          />
        ) : (
          <StatCard
            label={t('workspace.sales.codesAndLinks')}
            value={s.promoCodes.length + s.links.length}
            hint={t('workspace.sales.codesAndLinksHint', { codes: s.promoCodes.length, links: s.links.length })}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {finance ? t('workspace.sales.nothingEstimatedFinance', { currency: s.currency }) : t('workspace.sales.nothingEstimated')}
        {others.length ? ` ${t('workspace.sales.otherCurrencies', { amounts: money(others) })}` : null}
      </p>
    </div>
  );
}

function Creators({ s }: { s: CampaignSalesDTO }) {
  const t = useTranslations('campaigns');
  const locale = useLocale();
  const money = useMoney();
  const finance = s.spend !== null;
  if (s.creators.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('workspace.sales.byCreator')}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <TableScroll>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t('workspace.sales.creator')}</TableHeaderCell>
                <TableHeaderCell>{t('workspace.sales.codes')}</TableHeaderCell>
                <TableHeaderCell align="end">{t('workspace.sales.clicks')}</TableHeaderCell>
                <TableHeaderCell align="end">{t('workspace.sales.orders')}</TableHeaderCell>
                <TableHeaderCell align="end">{t('workspace.sales.revenue')}</TableHeaderCell>
                {finance ? (
                  <>
                    <TableHeaderCell align="end">{t('workspace.sales.fee')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('workspace.sales.roas')}</TableHeaderCell>
                    <TableHeaderCell align="end">{t('workspace.sales.costPerOrder')}</TableHeaderCell>
                  </>
                ) : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {s.creators.map((c) => (
                <TableRow key={c.influencerId}>
                  <TableCell>
                    <Link href={`/influencers/${c.influencerId}`} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
                      <Avatar src={c.avatarUrl} name={c.name} size="xs" />
                      <BidiText className="truncate">{c.name}</BidiText>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.codes.map((code) => (
                        <LtrText key={code} as="span" className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
                          {code}
                        </LtrText>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell align="end">{formatNumber(c.clicks, locale)}</TableCell>
                  <TableCell align="end">{formatNumber(c.orders, locale)}</TableCell>
                  <TableCell align="end">
                    <LtrText as="span">{money(c.revenue)}</LtrText>
                  </TableCell>
                  {finance ? (
                    <>
                      <TableCell align="end">
                        <LtrText as="span">{c.fee !== null ? formatCurrency(c.fee, s.currency, locale) : '—'}</LtrText>
                      </TableCell>
                      <TableCell align="end">{c.roas !== null ? <LtrText as="span">{`${formatNumber(c.roas, locale)}×`}</LtrText> : '—'}</TableCell>
                      <TableCell align="end">
                        <LtrText as="span">{c.costPerOrder !== null ? formatCurrency(c.costPerOrder, s.currency, locale) : '—'}</LtrText>
                      </TableCell>
                    </>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      </CardContent>
    </Card>
  );
}

function useRefresh(campaignId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: qk.campaign.sales(campaignId) });
}

function CreatorSelect({
  influencers,
  value,
  onChange,
}: {
  influencers: CampaignInfluencerDTO[];
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations('campaigns');
  return (
    <Field label={t('workspace.sales.creatorLabel')}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={t('workspace.sales.creatorLabel')}>
          <SelectValue placeholder={t('workspace.sales.pickCreator')} />
        </SelectTrigger>
        <SelectContent>
          {influencers.map((ci) => (
            <SelectItem key={ci.influencer.id} value={ci.influencer.id}>
              <BidiText>{ci.influencer.displayName}</BidiText>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

// --- Promo codes --------------------------------------------------------------

function PromoCodes({ s, campaign, influencers }: { s: CampaignSalesDTO; campaign: CampaignDetailDTO; influencers: CampaignInfluencerDTO[] }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const { shortDate } = useLocalizedFormat();
  const money = useMoney();
  const refresh = useRefresh(campaign.id);
  const [open, setOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<{ id: string; code: string } | null>(null);

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.sales.updatePromoCode(id, { isActive }),
    onSuccess: () => {
      toast.success(t('workspace.sales.codeUpdated'));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.sales.removePromoCode(id),
    onSuccess: () => {
      toast.success(t('workspace.sales.codeRemoved'));
      setRemoving(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const dates = (from: string | null, to: string | null) =>
    from && to
      ? t('workspace.sales.codeRange', { from: shortDate(from), to: shortDate(to) })
      : from
        ? t('workspace.sales.codeFrom', { date: shortDate(from) })
        : to
          ? t('workspace.sales.codeUntil', { date: shortDate(to) })
          : t('workspace.sales.codeAnyDate');

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" /> {t('workspace.sales.promoCodes')}
        </CardTitle>
        {s.canManage ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} disabled={influencers.length === 0}>
            <Plus className="h-4 w-4" /> {t('workspace.sales.addCode')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {s.promoCodes.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">{t('workspace.sales.noCodes')}</p>
        ) : (
          <div className="divide-y divide-border">
            {s.promoCodes.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-6 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <LtrText as="span" className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-sm font-semibold">
                      {c.code}
                    </LtrText>
                    {c.discount ? <span className="text-xs text-muted-foreground">{c.discount}</span> : null}
                    {!c.isActive ? <Badge tone="neutral">{t('workspace.sales.codeOff')}</Badge> : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    <BidiText>{c.influencerName}</BidiText> · {dates(c.validFrom, c.validTo)}
                  </p>
                </div>
                <div className="shrink-0 text-end text-xs">
                  <p className="font-medium text-foreground">{t('workspace.sales.ordersCount', { count: c.orders })}</p>
                  <LtrText as="p" className="text-muted-foreground">
                    {money(c.revenue)}
                  </LtrText>
                </div>
                {s.canManage ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={c.isActive}
                      disabled={toggle.isPending}
                      onCheckedChange={(v) => toggle.mutate({ id: c.id, isActive: v })}
                      aria-label={t('workspace.sales.codeActiveAria', { code: c.code })}
                    />
                    {c.orders === 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-danger"
                        aria-label={t('workspace.sales.removeCodeAria', { code: c.code })}
                        onClick={() => setRemoving({ id: c.id, code: c.code })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {s.canManage ? <PromoCodeDialog open={open} onOpenChange={setOpen} campaign={campaign} influencers={influencers} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={t('workspace.sales.removeCodeTitle')}
        description={removing ? t('workspace.sales.removeCodeDescription', { code: removing.code }) : undefined}
        confirmLabel={tCommon('delete')}
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Card>
  );
}

function PromoCodeDialog({
  open,
  onOpenChange,
  campaign,
  influencers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaign: CampaignDetailDTO;
  influencers: CampaignInfluencerDTO[];
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const refresh = useRefresh(campaign.id);
  const [influencerId, setInfluencerId] = React.useState('');
  const [code, setCode] = React.useState('');
  const [discount, setDiscount] = React.useState('');
  const [validFrom, setValidFrom] = React.useState('');
  const [validTo, setValidTo] = React.useState('');
  const [notes, setNotes] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setInfluencerId('');
      setCode('');
      setDiscount('');
      setValidFrom('');
      setValidTo('');
      setNotes('');
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      api.sales.createPromoCode(campaign.id, {
        influencerId,
        code: code.trim(),
        discount: discount.trim() || null,
        validFrom: validFrom ? new Date(validFrom) : null,
        validTo: validTo ? new Date(validTo) : null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      toast.success(t('workspace.sales.codeAdded'));
      refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const validCode = /^[\p{L}\p{N}#_\-\s]{2,40}$/u.test(code.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workspace.sales.codeDialogTitle')}</DialogTitle>
          <DialogDescription>{t('workspace.sales.codeDialogDescription')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (influencerId && validCode) create.mutate();
          }}
        >
          <CreatorSelect influencers={influencers} value={influencerId} onChange={setInfluencerId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('workspace.sales.codeLabel')} error={code && !validCode ? t('workspace.sales.codeInvalid') : undefined}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SARA15" dir="ltr" className="font-mono" maxLength={40} />
            </Field>
            <Field label={t('workspace.sales.discountLabel')} hint={t('fields.optionalHint')}>
              <Input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder={t('workspace.sales.discountPlaceholder')} maxLength={60} />
            </Field>
            <Field label={t('workspace.sales.validFromLabel')} hint={t('workspace.sales.validFromHint')}>
              <Input type="date" value={validFrom} max={validTo || undefined} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
            <Field label={t('workspace.sales.validToLabel')} hint={t('fields.optionalHint')}>
              <Input type="date" value={validTo} min={validFrom || undefined} onChange={(e) => setValidTo(e.target.value)} />
            </Field>
          </div>
          <Field label={t('workspace.sales.notesLabel')} hint={t('fields.optionalHint')}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !influencerId || !validCode}>
              {t('workspace.sales.addCode')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Tracking links -----------------------------------------------------------

function CopyLink({ url, label }: { url: string; label: string }) {
  const t = useTranslations('campaigns');
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t('workspace.sales.copyAria', { link: label })}
      title={t('workspace.sales.copy')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          toast.success(t('workspace.sales.copied'));
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — the link is still selectable */
        }
      }}
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function TrackingLinks({ s, campaign, influencers }: { s: CampaignSalesDTO; campaign: CampaignDetailDTO; influencers: CampaignInfluencerDTO[] }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const refresh = useRefresh(campaign.id);
  const [open, setOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<{ id: string; slug: string } | null>(null);
  const [origin, setOrigin] = React.useState('');
  React.useEffect(() => setOrigin(window.location.origin), []);

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.sales.updateLink(id, { isActive }),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.sales.removeLink(id),
    onSuccess: () => {
      toast.success(t('workspace.sales.linkRemoved'));
      setRemoving(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" /> {t('workspace.sales.links')}
        </CardTitle>
        {s.canManage ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} disabled={influencers.length === 0}>
            <Plus className="h-4 w-4" /> {t('workspace.sales.newLink')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {s.links.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">{t('workspace.sales.noLinks')}</p>
        ) : (
          <div className="divide-y divide-border">
            {s.links.map((l) => {
              const short = `${origin}${l.path}`;
              let host = l.destinationUrl;
              try {
                host = new URL(l.destinationUrl).host;
              } catch {
                /* keep as entered */
              }
              return (
                <div key={l.id} className="flex items-center gap-3 px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1">
                      <LtrText as="span" className="truncate font-mono text-sm font-medium">
                        {short.replace(/^https?:\/\//, '')}
                      </LtrText>
                      <CopyLink url={short} label={l.label ?? l.slug} />
                      {!l.isActive ? <Badge tone="neutral">{t('workspace.sales.linkPaused')}</Badge> : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      <BidiText>{l.influencerName}</BidiText>
                      {l.label ? (
                        <>
                          {' · '}
                          <BidiText>{l.label}</BidiText>
                        </>
                      ) : null}
                      {' → '}
                      <LtrText as="span">{host}</LtrText>
                    </p>
                  </div>
                  <div className="shrink-0 text-end text-xs">
                    <p className="font-medium text-foreground">{t('workspace.sales.clicksCount', { count: l.clicks })}</p>
                    <p className="text-muted-foreground">{t('workspace.sales.ordersCount', { count: l.orders })}</p>
                  </div>
                  {s.canManage ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Switch
                        checked={l.isActive}
                        disabled={toggle.isPending}
                        onCheckedChange={(v) => toggle.mutate({ id: l.id, isActive: v })}
                        aria-label={t('workspace.sales.countClicksAria', { link: l.label ?? l.slug })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-danger"
                        aria-label={t('workspace.sales.removeLinkAria', { link: l.label ?? l.slug })}
                        onClick={() => setRemoving({ id: l.id, slug: l.slug })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {s.links.length > 0 ? <p className="px-6 pb-4 pt-1 text-xs text-muted-foreground">{t('workspace.sales.linksHint')}</p> : null}
      </CardContent>
      {s.canManage ? <LinkDialog open={open} onOpenChange={setOpen} campaign={campaign} influencers={influencers} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={t('workspace.sales.removeLinkTitle')}
        description={t('workspace.sales.removeLinkDescription')}
        confirmLabel={tCommon('delete')}
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Card>
  );
}

function LinkDialog({
  open,
  onOpenChange,
  campaign,
  influencers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaign: CampaignDetailDTO;
  influencers: CampaignInfluencerDTO[];
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const refresh = useRefresh(campaign.id);
  const [influencerId, setInfluencerId] = React.useState('');
  const [destination, setDestination] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [utm, setUtm] = React.useState(true);
  React.useEffect(() => {
    if (open) {
      setInfluencerId('');
      setDestination('');
      setLabel('');
      setUtm(true);
    }
  }, [open]);
  const validUrl = /^https?:\/\/[^\s]+\.[^\s]+/i.test(destination.trim());

  const create = useMutation({
    mutationFn: () => api.sales.createLink(campaign.id, { influencerId, destinationUrl: destination.trim(), label: label.trim() || null, utm }),
    onSuccess: async (link) => {
      const url = `${window.location.origin}${link.path}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success(t('workspace.sales.linkCreatedCopied'));
      } catch {
        toast.success(t('workspace.sales.linkCreated'));
      }
      refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workspace.sales.linkDialogTitle')}</DialogTitle>
          <DialogDescription>{t('workspace.sales.linkDialogDescription')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (influencerId && validUrl) create.mutate();
          }}
        >
          <CreatorSelect influencers={influencers} value={influencerId} onChange={setInfluencerId} />
          <Field label={t('workspace.sales.destinationLabel')} error={destination && !validUrl ? t('workspace.sales.destinationInvalid') : undefined}>
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="https://" dir="ltr" inputMode="url" />
          </Field>
          <Field label={t('workspace.sales.labelLabel')} hint={t('fields.optionalHint')}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('workspace.sales.labelPlaceholder')} maxLength={120} />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <Switch checked={utm} onCheckedChange={setUtm} className="mt-0.5" aria-label={t('workspace.sales.utmLabel')} />
            <span>
              <span className="font-medium">{t('workspace.sales.utmLabel')}</span>
              <span className="block text-xs text-muted-foreground">{t('workspace.sales.utmHint')}</span>
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !influencerId || !validUrl}>
              {t('workspace.sales.newLink')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Sales ----------------------------------------------------------------------

function Sales({ s, campaign, influencers }: { s: CampaignSalesDTO; campaign: CampaignDetailDTO; influencers: CampaignInfluencerDTO[] }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { shortDate } = useLocalizedFormat();
  const refresh = useRefresh(campaign.id);
  const [importOpen, setImportOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [undoing, setUndoing] = React.useState<{ id: string; name: string; count: number } | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.sales.remove(id),
    onSuccess: () => {
      toast.success(t('workspace.sales.saleRemoved'));
      setRemoving(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const undo = useMutation({
    mutationFn: (id: string) => api.sales.undoImport(id),
    onSuccess: (r) => {
      toast.success(t('workspace.sales.undone', { count: r.removed }));
      setUndoing(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-muted-foreground" /> {t('workspace.sales.sales')}
        </CardTitle>
        {s.canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setAddOpen(true)} disabled={influencers.length === 0}>
              <Plus className="h-4 w-4" /> {t('workspace.sales.addSales')}
            </Button>
            <Button type="button" size="sm" onClick={() => setImportOpen(true)}>
              <FileUp className="h-4 w-4" /> {t('workspace.sales.importOrders')}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6 p-0">
        {s.recentSales.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">{t('workspace.sales.noSales')}</p>
        ) : (
          <TableScroll>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t('workspace.sales.date')}</TableHeaderCell>
                  <TableHeaderCell>{t('workspace.sales.creator')}</TableHeaderCell>
                  <TableHeaderCell>{t('workspace.sales.via')}</TableHeaderCell>
                  <TableHeaderCell>{t('workspace.sales.orderRef')}</TableHeaderCell>
                  <TableHeaderCell align="end">{t('workspace.sales.orders')}</TableHeaderCell>
                  <TableHeaderCell align="end">{t('workspace.sales.amount')}</TableHeaderCell>
                  {s.canManage ? <TableHeaderCell className="w-10" /> : null}
                </TableRow>
              </TableHead>
              <TableBody>
                {s.recentSales.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{shortDate(r.occurredAt)}</TableCell>
                    <TableCell>
                      <BidiText>{r.influencerName}</BidiText>
                    </TableCell>
                    <TableCell>
                      {r.code ? (
                        <LtrText as="span" className="font-mono text-xs">
                          {r.code}
                        </LtrText>
                      ) : r.linkSlug ? (
                        <LtrText as="span" className="font-mono text-xs">
                          {`/r/${r.linkSlug}`}
                        </LtrText>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t(`workspace.sales.source.${r.source}`)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.orderRef ? (
                        <LtrText as="span" className="text-xs">
                          {r.orderRef}
                        </LtrText>
                      ) : (
                        <span className="text-xs text-muted-foreground">{r.note ? <BidiText>{r.note}</BidiText> : '—'}</span>
                      )}
                    </TableCell>
                    <TableCell align="end">{formatNumber(r.orders, locale)}</TableCell>
                    <TableCell align="end">
                      <LtrText as="span">{formatCurrency(r.amount, r.currency, locale)}</LtrText>
                    </TableCell>
                    {s.canManage ? (
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-danger"
                          aria-label={t('workspace.sales.removeSaleAria')}
                          onClick={() => setRemoving(r.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}

        {s.imports.length > 0 ? (
          <div className="border-t border-border px-6 pb-6 pt-4">
            <h3 className="mb-2 text-sm font-semibold">{t('workspace.sales.files')}</h3>
            <ul className="space-y-2">
              {s.imports.map((f) => {
                const name = f.fileName ?? t('workspace.sales.unnamedFile');
                return (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        <BidiText>{name}</BidiText>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {shortDate(f.createdAt)}
                        {f.createdByName ? <> · <BidiText>{f.createdByName}</BidiText></> : null} ·{' '}
                        {t('workspace.sales.fileSummary', { imported: f.imported, duplicates: f.duplicates, unmatched: f.unmatched })}
                      </p>
                    </div>
                    {s.canManage && f.ordersOnRecord > 0 ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setUndoing({ id: f.id, name, count: f.ordersOnRecord })}>
                        <Undo2 className="h-4 w-4" /> {t('workspace.sales.undo')}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </CardContent>

      {s.canManage ? (
        <>
          <ImportDialog open={importOpen} onOpenChange={setImportOpen} campaign={campaign} />
          <AddSaleDialog open={addOpen} onOpenChange={setAddOpen} campaign={campaign} influencers={influencers} s={s} />
        </>
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={t('workspace.sales.removeSaleTitle')}
        confirmLabel={tCommon('delete')}
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
      <ConfirmDialog
        open={undoing !== null}
        onOpenChange={(v) => !v && setUndoing(null)}
        title={t('workspace.sales.undoTitle')}
        description={undoing ? t('workspace.sales.undoDescription', { count: undoing.count, file: undoing.name }) : undefined}
        confirmLabel={t('workspace.sales.undo')}
        loading={undo.isPending}
        onConfirm={() => undoing && undo.mutate(undoing.id)}
      />
    </Card>
  );
}

function AddSaleDialog({
  open,
  onOpenChange,
  campaign,
  influencers,
  s,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaign: CampaignDetailDTO;
  influencers: CampaignInfluencerDTO[];
  s: CampaignSalesDTO;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const refresh = useRefresh(campaign.id);
  const [influencerId, setInfluencerId] = React.useState('');
  const [promoCodeId, setPromoCodeId] = React.useState(NONE);
  const [orders, setOrders] = React.useState('1');
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState(campaign.currency);
  const [date, setDate] = React.useState(today());
  const [note, setNote] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setInfluencerId('');
      setPromoCodeId(NONE);
      setOrders('1');
      setAmount('');
      setCurrency(campaign.currency);
      setDate(today());
      setNote('');
    }
  }, [open, campaign.currency]);
  const codes = s.promoCodes.filter((c) => c.influencerId === influencerId);
  const ordersN = Number(orders);
  const amountN = Number(amount);
  const valid = influencerId && Number.isInteger(ordersN) && ordersN >= 1 && amount !== '' && amountN >= 0 && date;

  const create = useMutation({
    mutationFn: () =>
      api.sales.add(campaign.id, {
        influencerId,
        promoCodeId: promoCodeId === NONE ? null : promoCodeId,
        orders: ordersN,
        amount: amountN,
        currency,
        occurredAt: new Date(date),
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast.success(t('workspace.sales.saleAdded'));
      refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workspace.sales.addSaleTitle')}</DialogTitle>
          <DialogDescription>{t('workspace.sales.addSaleDescription')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate();
          }}
        >
          <CreatorSelect
            influencers={influencers}
            value={influencerId}
            onChange={(v) => {
              setInfluencerId(v);
              setPromoCodeId(NONE);
            }}
          />
          {codes.length > 0 ? (
            <Field label={t('workspace.sales.codeOptional')}>
              <Select value={promoCodeId} onValueChange={setPromoCodeId}>
                <SelectTrigger aria-label={t('workspace.sales.codeOptional')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('workspace.sales.noCode')}</SelectItem>
                  {codes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <LtrText as="span" className="font-mono">
                        {c.code}
                      </LtrText>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('workspace.sales.ordersLabel')}>
              <Input type="number" min={1} step={1} value={orders} onChange={(e) => setOrders(e.target.value)} />
            </Field>
            <Field label={t('workspace.sales.dateLabel')}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={t('workspace.sales.amountLabel')}>
              <Input type="number" min={0} step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.000" />
            </Field>
            <Field label={t('workspace.sales.currencyLabel')}>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger aria-label={t('workspace.sales.currencyLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([campaign.currency, ...CURRENCIES])].map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={t('workspace.sales.noteLabel')} hint={t('fields.optionalHint')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('workspace.sales.notePlaceholder')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !valid}>
              {t('workspace.sales.addSales')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Importing the shop's orders -------------------------------------------------

function ImportDialog({ open, onOpenChange, campaign }: { open: boolean; onOpenChange: (v: boolean) => void; campaign: CampaignDetailDTO }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const refresh = useRefresh(campaign.id);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [text, setText] = React.useState('');
  const [table, setTable] = React.useState<SalesTable | null>(null);
  const [map, setMap] = React.useState<ColumnMap>({});
  const [dateOrder, setDateOrder] = React.useState<'DMY' | 'MDY'>('DMY');
  const [currency, setCurrency] = React.useState(campaign.currency);
  const [result, setResult] = React.useState<SalesImportResultDTO | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setFileName(null);
      setText('');
      setTable(null);
      setMap({});
      setDateOrder('DMY');
      setCurrency(campaign.currency);
      setResult(null);
    }
  }, [open, campaign.currency]);

  function load(content: string, name: string | null) {
    const next = readSalesTable(content);
    setFileName(name);
    setTable(next.headers.length ? next : null);
    setMap(guessColumns(next.headers));
    setResult(null);
  }

  const ready =
    table !== null &&
    table.rows.length > 0 &&
    table.rows.length <= MAX_SALE_ROWS &&
    map.date !== undefined &&
    map.amount !== undefined &&
    (map.code !== undefined || map.link !== undefined);

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.sales.importFile(campaign.brandId, {
        fileName: fileName ?? null,
        dateOrder,
        currency,
        dryRun,
        rows: toImportRows(table!, map),
      }),
    onSuccess: (r) => {
      setResult(r);
      if (!r.dryRun) {
        toast.success(r.matched > 0 ? t('workspace.sales.imported', { count: r.matched }) : t('workspace.sales.nothingToImport'));
        refresh();
        onOpenChange(false);
      }
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const setField = (field: SaleField, v: string) => {
    setMap((m) => {
      const next = { ...m };
      if (v === NONE) delete next[field];
      else next[field] = Number(v);
      return next;
    });
    setResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('workspace.sales.importTitle')}</DialogTitle>
          <DialogDescription>{t('workspace.sales.importDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) load(await f.text(), f.name);
                e.target.value = '';
              }}
            />
            <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
              <FileUp className="h-4 w-4" /> {t('workspace.sales.chooseFile')}
            </Button>
            {table ? (
              <span className="text-sm text-muted-foreground">
                {t('workspace.sales.rowsRead', { count: table.rows.length })}
                {fileName ? (
                  <>
                    {' · '}
                    <BidiText>{fileName}</BidiText>
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
          <Field label={t('workspace.sales.orPaste')}>
            <Textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (e.target.value.trim()) load(e.target.value, null);
                else setTable(null);
              }}
              rows={3}
              dir="ltr"
              placeholder={t('workspace.sales.pastePlaceholder')}
              className="font-mono text-xs"
            />
          </Field>

          {table && table.rows.length > MAX_SALE_ROWS ? (
            <p className="text-sm text-danger">{t('workspace.sales.tooMany', { max: MAX_SALE_ROWS })}</p>
          ) : null}

          {table ? (
            <div className="space-y-3 rounded-xl border border-border p-4">
              <h3 className="text-sm font-semibold">{t('workspace.sales.columns')}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {SALE_FIELDS.map((field) => (
                  <Field key={field} label={t(`workspace.sales.field.${field}`)}>
                    <Select value={map[field] !== undefined ? String(map[field]) : NONE} onValueChange={(v) => setField(field, v)}>
                      <SelectTrigger aria-label={t(`workspace.sales.field.${field}`)}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t('workspace.sales.notInFile')}</SelectItem>
                        {table.headers.map((h, i) => (
                          <SelectItem key={`${i}-${h}`} value={String(i)}>
                            <BidiText>{h || `#${i + 1}`}</BidiText>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ))}
                <Field label={t('workspace.sales.dateOrderLabel')}>
                  <Select value={dateOrder} onValueChange={(v) => { setDateOrder(v as 'DMY' | 'MDY'); setResult(null); }}>
                    <SelectTrigger aria-label={t('workspace.sales.dateOrderLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DMY">{t('workspace.sales.dmy')}</SelectItem>
                      <SelectItem value="MDY">{t('workspace.sales.mdy')}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t('workspace.sales.defaultCurrencyLabel')}>
                  <Select value={currency} onValueChange={(v) => { setCurrency(v); setResult(null); }}>
                    <SelectTrigger aria-label={t('workspace.sales.defaultCurrencyLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[...new Set([campaign.currency, ...CURRENCIES])].map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {!ready && table.rows.length <= MAX_SALE_ROWS ? <p className="text-xs text-warning">{t('workspace.sales.needColumns')}</p> : null}
              {map.orderRef === undefined ? <p className="text-xs text-muted-foreground">{t('workspace.sales.noOrderNumbers')}</p> : null}
            </div>
          ) : null}

          {result ? <ImportResult result={result} /> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          {result && result.dryRun && result.matched > 0 ? (
            <Button type="button" disabled={run.isPending} onClick={() => run.mutate(false)}>
              {t('workspace.sales.importNow', { count: result.matched })}
            </Button>
          ) : (
            <Button type="button" disabled={run.isPending || !ready} onClick={() => run.mutate(true)}>
              {t('workspace.sales.check')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportResult({ result }: { result: SalesImportResultDTO }) {
  const t = useTranslations('campaigns');
  const money = useMoney();
  const line = (show: boolean, text: string, tone: 'muted' | 'warning' = 'muted') =>
    show ? <li className={tone === 'warning' ? 'text-warning' : 'text-muted-foreground'}>{text}</li> : null;
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-muted/40 p-4 text-sm" role="status">
      <p className="font-semibold">{t('workspace.sales.willCredit', { count: result.matched })}</p>
      {result.byCampaign.length ? (
        <ul className="space-y-0.5">
          {result.byCampaign.map((b) => (
            <li key={b.campaignId}>
              <BidiText>{b.campaignName}</BidiText>: {t('workspace.sales.ordersCount', { count: b.orders })} ·{' '}
              <LtrText as="span">{money(b.revenue)}</LtrText>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="space-y-0.5 text-xs">
        {line(result.duplicates > 0, t('workspace.sales.resultDuplicates', { count: result.duplicates }))}
        {line(result.unmatched > 0, t('workspace.sales.resultUnmatched', { count: result.unmatched }), 'warning')}
        {line(
          result.unknownCodes.length > 0,
          t('workspace.sales.resultUnknownCodes', { codes: result.unknownCodes.map((u) => `${u.code} (${u.rows})`).join(', ') }),
          'warning',
        )}
        {line(result.outsideDates > 0, t('workspace.sales.resultOutside', { count: result.outsideDates }), 'warning')}
        {line(result.cancelled > 0, t('workspace.sales.resultCancelled', { count: result.cancelled }))}
        {line(result.invalidCount > 0, t('workspace.sales.resultInvalid', { count: result.invalidCount }), 'warning')}
      </ul>
      {result.invalid.length ? (
        <p className="text-xs text-muted-foreground">
          {result.invalid
            .slice(0, 8)
            .map((i) => t('workspace.sales.invalidLine', { row: i.row, problem: t(`workspace.sales.problem.${i.problem}`) }))
            .join(' · ')}
        </p>
      ) : null}
    </div>
  );
}
