'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Paperclip, X } from 'lucide-react';
import { PAYMENT_METHODS, type AttachmentDTO, type AttachmentTarget, type PaymentDTO, type PaymentMethod } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { uploadAttachment } from '@/lib/upload';
import { enumLabel } from '@/lib/enum-labels';
import { formatCurrency } from '@/lib/format';
import { BidiText } from '@/components/common/bidi-text';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/errors';

export type PaymentTargetRef = { kind: 'FEE'; id: string } | { kind: 'EXPENSE'; id: string };

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Record a payment against a creator's fee or an expense (P2.3): how much,
 * when, how (transfer, cash…), the transfer/cheque number and, optionally,
 * the receipt. The amount starts at what is still owed.
 */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  target,
  payeeName,
  owed,
  currency,
  receiptTarget,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PaymentTargetRef;
  payeeName: string;
  owed: number;
  currency: string;
  /** Where a receipt file is stored: the roster row for a fee, the campaign for an expense. */
  receiptTarget: AttachmentTarget;
  onRecorded?: (payment: PaymentDTO) => void;
}) {
  const t = useTranslations('finance');
  const tEnums = useTranslations('enums');
  const tCommon = useTranslations('common');
  const [amount, setAmount] = React.useState('');
  const [paidAt, setPaidAt] = React.useState(today());
  const [method, setMethod] = React.useState<PaymentMethod>('BANK_TRANSFER');
  const [reference, setReference] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [receipt, setReceipt] = React.useState<AttachmentDTO | null>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setAmount(owed > 0 ? String(Math.round(owed * 1000) / 1000) : '');
    setPaidAt(today());
    setMethod('BANK_TRANSFER');
    setReference('');
    setNotes('');
    setReceipt(null);
    setProgress(null);
  }, [open, owed]);

  const value = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0 && value <= owed + 0.0005;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        amount: value,
        paidAt: new Date(`${paidAt}T12:00:00`),
        method,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        receiptAttachmentId: receipt?.id ?? null,
      };
      return target.kind === 'FEE' ? api.finance.payFee(target.id, body) : api.finance.payExpense(target.id, body);
    },
    onSuccess: (payment) => {
      toast.success(t('dialog.saved'));
      onOpenChange(false);
      onRecorded?.(payment);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  async function attach(file: File) {
    setProgress(0);
    try {
      setReceipt(await uploadAttachment(file, receiptTarget, setProgress));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tCommon('somethingWentWrong'));
    } finally {
      setProgress(null);
    }
  }

  async function detach() {
    if (!receipt) return;
    const id = receipt.id;
    setReceipt(null);
    await api.files.remove(id).catch(() => undefined);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dialog.title')}</DialogTitle>
          <DialogDescription>
            {t.rich('dialog.for', { name: () => <BidiText>{payeeName}</BidiText> })} ·{' '}
            {t('dialog.owed', { amount: formatCurrency(owed, currency) })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <Field label={`${t('dialog.amount')} (${currency})`}>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={amount !== '' && !valid}
              required
            />
          </Field>
          <Field label={t('dialog.date')}>
            <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
          </Field>
          <Field label={t('dialog.method')}>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger aria-label={t('dialog.method')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {enumLabel(tEnums, 'paymentMethod', m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('dialog.reference')}>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('dialog.referencePlaceholder')} dir="auto" />
          </Field>
          <Field label={t('dialog.notes')} className="sm:col-span-2">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} dir="auto" />
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium">{t('dialog.receipt')}</p>
            {receipt ? (
              <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{receipt.fileName}</span>
                <Button type="button" variant="ghost" size="icon-sm" onClick={detach} aria-label={tCommon('remove')}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void attach(file);
                  }}
                />
                <Button type="button" variant="outline" size="sm" disabled={progress !== null} onClick={() => fileInput.current?.click()}>
                  {progress !== null ? <Spinner className="h-3.5 w-3.5" /> : <Paperclip className="h-3.5 w-3.5" />}
                  {progress !== null ? t('dialog.uploading', { percent: Math.round(progress * 100) }) : t('dialog.attachReceipt')}
                </Button>
              </>
            )}
          </div>
          {amount !== '' && !valid ? <p className="text-sm text-danger sm:col-span-2">{t('dialog.invalidAmount')}</p> : null}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={!valid || save.isPending || progress !== null}>
              {save.isPending ? <Spinner className="h-4 w-4" /> : null}
              {t('dialog.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
