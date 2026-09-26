'use client';

import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Wallet } from 'lucide-react';
import type { CurrencyTotalDTO, PayableDTO, PaymentDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { formatCurrency, useLocalizedFormat } from '@/lib/format';
import { toBrowserUrl } from '@/lib/upload';
import { cn } from '@/lib/cn';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { useApp } from '@/components/shell/app-context';
import { RecordPaymentDialog } from '@/components/finance/record-payment-dialog';
import { VoidPaymentDialog } from '@/components/finance/payment-history';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const ALL = '__all__';

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function Totals({ label, totals }: { label: string; totals: CurrencyTotalDTO[] | undefined }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-baseline gap-x-6 gap-y-1 p-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        {(totals?.length ? totals : [{ currency: 'KWD', amount: 0 }]).map((tot) => (
          <span key={tot.currency} className="text-2xl font-bold tabular-nums">
            <LtrText>{formatCurrency(tot.amount, tot.currency)}</LtrText>
          </span>
        ))}
      </CardContent>
    </Card>
  );
}

/** The two Finance tabs: what is still owed, and every payment made. */
export function FinanceWorkspace() {
  const t = useTranslations('finance');
  const { brands } = useApp();
  const [tab, setTab] = React.useState('payables');
  const [brandId, setBrandId] = React.useState(ALL);
  const [q, setQ] = React.useState('');
  const search = useDebounced(q.trim());
  const filters = { brandId: brandId === ALL ? undefined : brandId, q: search || undefined };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('filters.search')} className="sm:max-w-xs" dir="auto" />
        <Select value={brandId} onValueChange={setBrandId}>
          <SelectTrigger className="sm:w-56" aria-label={t('filters.brand')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allBrands')}</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                <BidiText>{b.name}</BidiText>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="payables">{t('tabs.payables')}</TabsTrigger>
          <TabsTrigger value="payments">{t('tabs.payments')}</TabsTrigger>
        </TabsList>
        <TabsContent value="payables">
          <Payables filters={filters} />
        </TabsContent>
        <TabsContent value="payments">
          <Payments filters={filters} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Filters = { brandId?: string; q?: string };

function pageLabels(t: ReturnType<typeof useTranslations>, tc: ReturnType<typeof useTranslations>) {
  return {
    previousLabel: tc('previous'),
    nextLabel: tc('next'),
    pageAriaLabel: (p: number) => `${t('title')} ${p}`,
  };
}

function Payables({ filters }: { filters: Filters }) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const locale = useLocale();
  const fmt = useLocalizedFormat();
  const { can } = useApp();
  const queryClient = useQueryClient();
  const [kind, setKind] = React.useState<'ALL' | 'FEE' | 'EXPENSE'>('ALL');
  const [page, setPage] = React.useState(1);
  const [paying, setPaying] = React.useState<PayableDTO | null>(null);
  React.useEffect(() => setPage(1), [filters.brandId, filters.q, kind]);

  const params = { ...filters, kind: kind === 'ALL' ? undefined : kind };
  const res = useQuery({
    queryKey: ['finance', 'payables', params, page],
    queryFn: () => api.finance.payables({ ...params, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
          <SelectTrigger className="w-48" aria-label={t('cols.payee')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('filters.allKinds')}</SelectItem>
            <SelectItem value="FEE">{t('filters.fees')}</SelectItem>
            <SelectItem value="EXPENSE">{t('filters.expenses')}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" asChild>
          <a href={api.finance.payablesXlsxUrl({ ...params, locale })} download>
            <FileSpreadsheet className="h-4 w-4" /> {t('downloadExcel')}
          </a>
        </Button>
      </div>
      <Totals label={t('totalOwed')} totals={res.data?.totals} />
      {res.isLoading ? (
        <Skeleton className="h-40" />
      ) : !res.data?.data.length ? (
        <EmptyState icon={Wallet} title={t('nothingOwed')} />
      ) : (
        <Card>
          <TableScroll>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t('cols.payee')}</TableHeaderCell>
                  <TableHeaderCell>{t('cols.campaign')}</TableHeaderCell>
                  <TableHeaderCell className="text-end">{t('cols.amount')}</TableHeaderCell>
                  <TableHeaderCell className="text-end">{t('cols.paid')}</TableHeaderCell>
                  <TableHeaderCell className="text-end">{t('cols.owed')}</TableHeaderCell>
                  <TableHeaderCell>{t('cols.due')}</TableHeaderCell>
                  <TableHeaderCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {res.data.data.map((r) => (
                  <TableRow key={`${r.kind}:${r.id}`}>
                    <TableCell>
                      <p className="font-medium">
                        {r.influencerId ? (
                          <Link href={`/influencers/${r.influencerId}`} className="hover:underline">
                            <BidiText>{r.influencerName ?? '—'}</BidiText>
                          </Link>
                        ) : (
                          <BidiText>{r.label ?? '—'}</BidiText>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(`kind.${r.kind}`)}
                        {r.kind === 'EXPENSE' && r.influencerName && r.label ? (
                          <>
                            {' · '}
                            <BidiText>{r.label}</BidiText>
                          </>
                        ) : null}
                        {r.paymentsCount > 0 ? ` · ${t('paymentsCount', { count: r.paymentsCount })}` : null}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Link href={`/campaigns/${r.campaignId}?tab=costs`} className="hover:underline">
                        <BidiText>{r.campaignName}</BidiText>
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        <BidiText>{r.brandName}</BidiText>
                      </p>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      <LtrText>{formatCurrency(r.amount, r.currency)}</LtrText>
                    </TableCell>
                    <TableCell className="text-end tabular-nums text-muted-foreground">
                      <LtrText>{formatCurrency(r.paid, r.currency)}</LtrText>
                    </TableCell>
                    <TableCell className="text-end font-semibold tabular-nums">
                      <LtrText>{formatCurrency(r.owed, r.currency)}</LtrText>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{r.dueAt ? fmt.shortDate(r.dueAt) : '—'}</TableCell>
                    <TableCell className="text-end">
                      {can('FINANCE_MANAGE') ? (
                        <Button size="sm" variant="outline" onClick={() => setPaying(r)}>
                          {t('recordPayment')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        </Card>
      )}
      {res.data ? (
        <Pagination page={page} totalPages={res.data.pagination.totalPages} onPageChange={setPage} {...pageLabels(t, tc)} />
      ) : null}
      {paying ? (
        <RecordPaymentDialog
          open={!!paying}
          onOpenChange={(o) => (o ? null : setPaying(null))}
          target={{ kind: paying.kind, id: paying.id }}
          payeeName={paying.influencerName ?? paying.label ?? ''}
          owed={paying.owed}
          currency={paying.currency}
          receiptTarget={paying.kind === 'FEE' ? { campaignInfluencerId: paying.id } : { campaignId: paying.campaignId }}
          onRecorded={() => void queryClient.invalidateQueries({ queryKey: ['finance'] })}
        />
      ) : null}
    </div>
  );
}

function Payments({ filters }: { filters: Filters }) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const tEnums = useTranslations('enums');
  const locale = useLocale();
  const fmt = useLocalizedFormat();
  const { can } = useApp();
  const queryClient = useQueryClient();
  const [includeVoided, setIncludeVoided] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [voiding, setVoiding] = React.useState<PaymentDTO | null>(null);
  React.useEffect(() => setPage(1), [filters.brandId, filters.q, includeVoided]);

  const params = { ...filters, includeVoided: includeVoided ? 'true' : undefined };
  const res = useQuery({
    queryKey: ['finance', 'payments', params, page],
    queryFn: () => api.finance.payments({ ...params, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={includeVoided} onCheckedChange={setIncludeVoided} aria-label={t('filters.showVoided')} />
          {t('filters.showVoided')}
        </label>
        <Button variant="outline" size="sm" asChild>
          <a href={api.finance.paymentsXlsxUrl({ ...params, locale })} download>
            <FileSpreadsheet className="h-4 w-4" /> {t('downloadExcel')}
          </a>
        </Button>
      </div>
      <Totals label={t('totalPaid')} totals={res.data?.totals} />
      {res.isLoading ? (
        <Skeleton className="h-40" />
      ) : !res.data?.data.length ? (
        <EmptyState icon={Wallet} title={t('noPayments')} />
      ) : (
        <Card>
          <TableScroll>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t('cols.date')}</TableHeaderCell>
                  <TableHeaderCell>{t('cols.payee')}</TableHeaderCell>
                  <TableHeaderCell>{t('cols.campaign')}</TableHeaderCell>
                  <TableHeaderCell className="text-end">{t('cols.amount')}</TableHeaderCell>
                  <TableHeaderCell>{t('cols.method')}</TableHeaderCell>
                  <TableHeaderCell>{t('cols.reference')}</TableHeaderCell>
                  <TableHeaderCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {res.data.data.map((p) => (
                  <TableRow key={p.id} className={cn(p.voidedAt && 'text-muted-foreground')}>
                    <TableCell className="whitespace-nowrap">{fmt.shortDate(p.paidAt)}</TableCell>
                    <TableCell>
                      <p className="font-medium">
                        <BidiText>{p.influencerName ?? p.expenseLabel ?? '—'}</BidiText>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.kind === 'EXPENSE' && p.expenseType ? enumLabel(tEnums, 'expenseType', p.expenseType) : t(`kind.${p.kind}`)}
                        {p.recordedByName ? ` · ${t('ledger.recordedBy', { name: p.recordedByName })}` : null}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Link href={`/campaigns/${p.campaignId}?tab=costs`} className="hover:underline">
                        <BidiText>{p.campaignName}</BidiText>
                      </Link>
                    </TableCell>
                    <TableCell className={cn('text-end font-semibold tabular-nums', p.voidedAt && 'line-through')}>
                      <LtrText>{formatCurrency(p.amount, p.currency)}</LtrText>
                    </TableCell>
                    <TableCell>{enumLabel(tEnums, 'paymentMethod', p.method)}</TableCell>
                    <TableCell>
                      {p.reference ? <LtrText>{p.reference}</LtrText> : '—'}
                      {p.receipt ? (
                        <a href={toBrowserUrl(p.receipt.downloadUrl)} target="_blank" rel="noreferrer" className="ms-2 text-brand hover:underline">
                          {t('receipt')}
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-end">
                      {p.voidedAt ? (
                        <Badge tone="neutral" title={t('voidedBy', { name: p.voidedByName ?? '—', date: fmt.shortDate(p.voidedAt), reason: p.voidReason ?? '' })}>
                          {t('voided')}
                        </Badge>
                      ) : can('FINANCE_MANAGE') ? (
                        <Button size="sm" variant="ghost" onClick={() => setVoiding(p)}>
                          {t('void')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        </Card>
      )}
      {res.data ? (
        <Pagination page={page} totalPages={res.data.pagination.totalPages} onPageChange={setPage} {...pageLabels(t, tc)} />
      ) : null}
      <VoidPaymentDialog
        payment={voiding}
        onClose={() => setVoiding(null)}
        onVoided={() => void queryClient.invalidateQueries({ queryKey: ['finance'] })}
      />
    </div>
  );
}
