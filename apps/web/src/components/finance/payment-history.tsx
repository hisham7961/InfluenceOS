'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Paperclip, Plus } from 'lucide-react';
import type { AttachmentTarget, PaymentDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { formatCurrency, useLocalizedFormat } from '@/lib/format';
import { toBrowserUrl } from '@/lib/upload';
import { cn } from '@/lib/cn';
import { LtrText } from '@/components/common/bidi-text';
import { useApp } from '@/components/shell/app-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { RecordPaymentDialog, type PaymentTargetRef } from './record-payment-dialog';

export const paymentsKey = (target: PaymentTargetRef) => ['finance', 'payments', target.kind, target.id] as const;

/**
 * The payments recorded against one fee or expense (voided ones shown struck
 * through, with who voided them and why), "Record payment" while something
 * is still owed, and "Void" on each live payment — for users who may record
 * money. Replaces typing a status and a paid amount by hand.
 */
export function PaymentHistory({
  target,
  payeeName,
  amount,
  owed,
  currency,
  receiptTarget,
  onChanged,
}: {
  target: PaymentTargetRef;
  payeeName: string;
  amount: number;
  owed: number;
  currency: string;
  receiptTarget: AttachmentTarget;
  onChanged?: () => void;
}) {
  const t = useTranslations('finance');
  const tEnums = useTranslations('enums');
  const fmt = useLocalizedFormat();
  const { can } = useApp();
  const canManage = can('FINANCE_MANAGE');
  const queryClient = useQueryClient();
  const [recordOpen, setRecordOpen] = React.useState(false);
  const [voiding, setVoiding] = React.useState<PaymentDTO | null>(null);

  const payments = useQuery({
    queryKey: paymentsKey(target),
    queryFn: () =>
      api.finance.payments({
        ...(target.kind === 'FEE' ? { campaignInfluencerId: target.id } : { expenseId: target.id }),
        includeVoided: true,
        pageSize: 100,
      }),
  });
  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: ['finance'] });
    onChanged?.();
  };

  const paid = (payments.data?.data ?? []).filter((p) => !p.voidedAt).reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{t('ledger.title')}</p>
        <p className="text-xs text-muted-foreground">
          <LtrText>{t('ledger.paidOf', { paid: formatCurrency(paid, currency), amount: formatCurrency(amount, currency) })}</LtrText>
        </p>
      </div>
      {payments.isLoading ? (
        <Skeleton className="h-10" />
      ) : (payments.data?.data.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">{t('ledger.none')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {payments.data!.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className={cn('font-medium tabular-nums', p.voidedAt && 'text-muted-foreground line-through')}>
                <LtrText>{formatCurrency(p.amount, p.currency)}</LtrText>
              </span>
              <span className="text-muted-foreground">{fmt.shortDate(p.paidAt)}</span>
              <span className="text-muted-foreground">{enumLabel(tEnums, 'paymentMethod', p.method)}</span>
              {p.reference ? (
                <span className="text-muted-foreground">
                  <LtrText>{p.reference}</LtrText>
                </span>
              ) : null}
              {p.receipt ? (
                <a
                  href={toBrowserUrl(p.receipt.downloadUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-brand hover:underline"
                >
                  <Paperclip className="h-3.5 w-3.5" /> {t('receipt')}
                </a>
              ) : null}
              {p.voidedAt ? (
                <Badge tone="neutral" className="ms-auto" title={t('voidedBy', { name: p.voidedByName ?? '—', date: fmt.shortDate(p.voidedAt), reason: p.voidReason ?? '' })}>
                  {t('voided')}
                </Badge>
              ) : canManage ? (
                <Button variant="ghost" size="sm" className="ms-auto h-7 text-muted-foreground" onClick={() => setVoiding(p)}>
                  <Ban className="h-3.5 w-3.5" /> {t('void')}
                </Button>
              ) : null}
              {p.voidedAt ? (
                <p className="basis-full text-xs text-muted-foreground">
                  {t('voidedBy', { name: p.voidedByName ?? '—', date: fmt.shortDate(p.voidedAt), reason: p.voidReason ?? '' })}
                </p>
              ) : p.recordedByName ? (
                <p className="basis-full text-xs text-muted-foreground">{t('ledger.recordedBy', { name: p.recordedByName })}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage && owed > 0.0005 ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setRecordOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> {t('recordPayment')}
        </Button>
      ) : null}

      <RecordPaymentDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        target={target}
        payeeName={payeeName}
        owed={owed}
        currency={currency}
        receiptTarget={receiptTarget}
        onRecorded={changed}
      />
      <VoidPaymentDialog payment={voiding} onClose={() => setVoiding(null)} onVoided={changed} />
    </div>
  );
}

/** Void a payment: it stays on record, marked voided, and stops counting. */
export function VoidPaymentDialog({
  payment,
  onClose,
  onVoided,
}: {
  payment: PaymentDTO | null;
  onClose: () => void;
  onVoided?: (payment: PaymentDTO) => void;
}) {
  const t = useTranslations('finance');
  const tCommon = useTranslations('common');
  const [reason, setReason] = React.useState('');
  React.useEffect(() => setReason(''), [payment]);
  const voidIt = useMutation({
    mutationFn: () => api.finance.voidPayment(payment!.id, reason.trim()),
    onSuccess: (p) => {
      toast.success(t('voidedToast'));
      onClose();
      onVoided?.(p);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tCommon('somethingWentWrong')),
  });
  return (
    <Dialog open={!!payment} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('voidTitle')}</DialogTitle>
          <DialogDescription>
            {payment ? (
              <>
                <LtrText>{formatCurrency(payment.amount, payment.currency)}</LtrText> · {t('voidBody')}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) voidIt.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t('voidReason')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('voidReasonPlaceholder')} required dir="auto" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={!reason.trim() || voidIt.isPending}>
              {voidIt.isPending ? <Spinner className="h-4 w-4" /> : null}
              {t('voidConfirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
