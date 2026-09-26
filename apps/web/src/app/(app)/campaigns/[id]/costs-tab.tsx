'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  Package,
  Pencil,
  Receipt,
  Target,
  Trash2,
  Wallet,
} from 'lucide-react';
import type {
  CampaignInfluencerDTO,
  CostSummaryDTO,
  ExpenseDTO,
  ExpenseType,
  PaymentStatus,
} from '@influenceos/contracts';
import { EXPENSE_TYPES, PAYMENT_STATUSES } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PaymentStatusBadge } from '@/components/ui/status-badges';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field, Input, Textarea } from '@/components/ui/input';
import { StatCard } from '@/components/ui/stat-card';
import { ProgressBar } from '@/components/ui/progress';
import { formatCurrency, formatPercent, useLocalizedFormat } from '@/lib/format';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useApp } from '@/components/shell/app-context';
import { PaymentHistory } from '@/components/finance/payment-history';
import { errorMessage } from '@/lib/errors';
import { NONE, toDateInputValue } from './workspace-shared';

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

function ExpenseRow({ expense }: { expense: ExpenseDTO }) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const tFinance = useTranslations('finance');
  const { shortDate } = useLocalizedFormat();
  const { can } = useApp();
  const canManage = can('FINANCE_MANAGE');
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = React.useState(false);
  const [paymentsOpen, setPaymentsOpen] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const refresh = () => {
    queryClient.invalidateQueries();
  };

  // Deleting puts it in the campaign's deleted expenses, where it can be restored.
  const remove = useMutation({
    mutationFn: () => api.expenses.remove(expense.id),
    onSuccess: () => {
      toast.success(t('workspace.expenses.removedToast'));
      refresh();
      setRemoveOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const typeLabel = enumLabel(tEnums, 'expenseType', expense.type);
  const name = expense.label || typeLabel;

  return (
    <div className="flex items-center gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
        <Receipt className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          <BidiText>{name}</BidiText>
        </p>
        <p className="text-xs text-muted-foreground">
          {typeLabel} · {expense.incurredAt ? shortDate(expense.incurredAt) : t('workspace.expenses.noDate')}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <LtrText as="span" className="text-sm font-semibold text-foreground">{formatCurrency(expense.amount, expense.currency)}</LtrText>
        <PaymentStatusBadge status={expense.paymentStatus} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('workspace.expenses.paymentsAriaLabel', { name })}
          title={tFinance('payments')}
          onClick={() => setPaymentsOpen(true)}
        >
          <Wallet className="h-4 w-4" />
        </Button>
        {canManage ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('workspace.expenses.editAriaLabel', { name })}
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('workspace.expenses.removeAriaLabel', { name })}
              className="text-muted-foreground hover:text-danger"
              onClick={() => setRemoveOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        ) : null}
      </div>

      {canManage ? <EditExpenseDialog expense={expense} open={editOpen} onOpenChange={setEditOpen} /> : null}
      <Dialog open={paymentsOpen} onOpenChange={setPaymentsOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tFinance('payments')}</DialogTitle>
            <DialogDescription>{t('workspace.expenses.paymentsDialogDescription', { name })}</DialogDescription>
          </DialogHeader>
          <PaymentHistory
            target={{ kind: 'EXPENSE', id: expense.id }}
            payeeName={name}
            amount={expense.amount}
            owed={Math.max(0, expense.amount - (expense.paidAmount ?? 0))}
            currency={expense.currency}
            receiptTarget={{ campaignId: expense.campaignId }}
            onChanged={refresh}
          />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t('workspace.expenses.removeConfirmTitle')}
        description={t('workspace.expenses.removeConfirmDescription', { name })}
        confirmLabel={t('workspace.expenses.moveToTrash')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

/** The campaign's deleted expenses, each restorable by people who manage finance. */
function DeletedExpenses({ campaignId }: { campaignId: string }) {
  const t = useTranslations('finance');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const { shortDate } = useLocalizedFormat();
  const { can } = useApp();
  const queryClient = useQueryClient();
  const trash = useQuery({
    queryKey: ['finance', 'expense-trash', campaignId],
    queryFn: () => api.expenses.trash(campaignId),
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.expenses.restore(id),
    onSuccess: () => {
      toast.success(t('trash.restored'));
      queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const rows = trash.data ?? [];
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-muted-foreground" /> {t('trash.title')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('trash.hint')}</p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {rows.map((e) => {
            const name = e.label || enumLabel(tEnums, 'expenseType', e.type);
            return (
              <div key={e.id} className="flex items-center gap-3 p-4 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-muted-foreground line-through">
                    <BidiText>{name}</BidiText>
                  </p>
                  {e.deletedAt ? <p className="text-xs text-muted-foreground">{t('trash.deletedOn', { date: shortDate(e.deletedAt) })}</p> : null}
                </div>
                <LtrText as="span" className="shrink-0 text-muted-foreground">{formatCurrency(e.amount, e.currency)}</LtrText>
                {can('FINANCE_MANAGE') ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(e.id)}
                  >
                    {t('trash.restore')}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The "how much / when" of a payment, shown under a payment status: the date
 * for a paid or part-paid item, and the amount paid so far for a part
 * payment (the money totals count exactly that much as paid).
 */
function PaymentDetailFields({
  paymentStatus,
  paidAmount,
  onPaidAmount,
  paidAt,
  onPaidAt,
}: {
  paymentStatus: PaymentStatus;
  paidAmount: string;
  onPaidAmount: (v: string) => void;
  paidAt: string;
  onPaidAt: (v: string) => void;
}) {
  const t = useTranslations('campaigns');
  if (paymentStatus !== 'PAID' && paymentStatus !== 'PARTIALLY_PAID') return null;
  return (
    <div className="grid grid-cols-2 gap-4">
      {paymentStatus === 'PARTIALLY_PAID' ? (
        <Field label={t('workspace.influencers.paidAmountLabel')} hint={t('workspace.influencers.paidAmountHint')}>
          <Input type="number" min={0} step="0.01" value={paidAmount} onChange={(e) => onPaidAmount(e.target.value)} placeholder="0.00" />
        </Field>
      ) : null}
      <Field label={t('workspace.influencers.paidAtLabel')} hint={t('fields.optionalHint')}>
        <Input type="date" value={paidAt} onChange={(e) => onPaidAt(e.target.value)} />
      </Field>
    </div>
  );
}

/** Paid amount and date to send for a payment status (cleared when not paid). */
function paymentDetailPayload(paymentStatus: PaymentStatus, paidAmount: string, paidAt: string, fullAmount: number) {
  const hasPayment = paymentStatus === 'PAID' || paymentStatus === 'PARTIALLY_PAID';
  const partial = paidAmount.trim() ? Number(paidAmount) : null;
  return {
    paidAmount: paymentStatus === 'PARTIALLY_PAID' ? partial : paymentStatus === 'PAID' ? fullAmount : null,
    paidAt: hasPayment && paidAt ? new Date(`${paidAt}T12:00:00`) : null,
  };
}

function EditExpenseDialog({
  expense,
  open,
  onOpenChange,
}: {
  expense: ExpenseDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const queryClient = useQueryClient();
  const [type, setType] = React.useState<ExpenseType>(expense.type);
  const [label, setLabel] = React.useState(expense.label ?? '');
  const [amount, setAmount] = React.useState(String(expense.amount));
  const [incurredAt, setIncurredAt] = React.useState(toDateInputValue(expense.incurredAt));
  const [notes, setNotes] = React.useState(expense.notes ?? '');

  React.useEffect(() => {
    if (open) {
      setType(expense.type);
      setLabel(expense.label ?? '');
      setAmount(String(expense.amount));
      setIncurredAt(toDateInputValue(expense.incurredAt));
      setNotes(expense.notes ?? '');
    }
  }, [open, expense]);

  const save = useMutation({
    mutationFn: () => {
      const parsed = Number(amount);
      if (!amount.trim() || !Number.isFinite(parsed) || parsed < 0) {
        throw new Error(t('workspace.expenses.invalidAmount'));
      }
      return api.expenses.update(expense.id, {
        type,
        label: label.trim() || null,
        amount: parsed,
        incurredAt: incurredAt ? new Date(incurredAt) : null,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success(t('workspace.expenses.updatedToast'));
      queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('workspace.expenses.editDialogTitle')}</DialogTitle>
          <DialogDescription>{t('workspace.expenses.editDialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t('fields.type')}>
            <Select value={type} onValueChange={(v) => setType(v as ExpenseType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_TYPES.map((et) => (
                  <SelectItem key={et} value={et}>
                    {enumLabel(tEnums, 'expenseType', et)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('workspace.expenses.labelField')} hint={t('fields.optionalHint')}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('workspace.expenses.labelPlaceholder')} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('workspace.expenses.amountLabel')}>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </Field>
            <Field label={t('workspace.expenses.incurredOnLabel')} hint={t('fields.optionalHint')}>
              <Input type="date" value={incurredAt} onChange={(e) => setIncurredAt(e.target.value)} />
            </Field>
          </div>
          <Field label={t('fields.notes')} hint={t('fields.optionalHint')}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={!amount.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? tCommon('saving') : t('workspace.saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddExpenseForm({
  campaignId,
  currency,
  influencers,
}: {
  campaignId: string;
  currency: string;
  influencers: CampaignInfluencerDTO[];
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const queryClient = useQueryClient();
  const [type, setType] = React.useState<ExpenseType>('OTHER');
  const [label, setLabel] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [paymentStatus, setPaymentStatus] = React.useState<PaymentStatus>('UNPAID');
  const [paidAmount, setPaidAmount] = React.useState('');
  const [paidAt, setPaidAt] = React.useState('');
  const [incurredAt, setIncurredAt] = React.useState('');
  const [campaignInfluencerId, setCampaignInfluencerId] = React.useState(NONE);
  const [notes, setNotes] = React.useState('');

  const addExpense = useMutation({
    mutationFn: () => {
      const parsed = Number(amount);
      if (!amount.trim() || !Number.isFinite(parsed) || parsed < 0) {
        throw new Error(t('workspace.expenses.invalidAmount'));
      }
      return api.campaigns.addExpense(campaignId, {
        type,
        label: label.trim() || undefined,
        amount: parsed,
        currency,
        paymentStatus,
        ...paymentDetailPayload(paymentStatus, paidAmount, paidAt, parsed),
        incurredAt: incurredAt ? new Date(incurredAt) : undefined,
        notes: notes.trim() || undefined,
        campaignInfluencerId: campaignInfluencerId === NONE ? undefined : campaignInfluencerId,
      });
    },
    onSuccess: () => {
      toast.success(t('workspace.expenses.addedToast'));
      setType('OTHER');
      setLabel('');
      setAmount('');
      setPaymentStatus('UNPAID');
      setPaidAmount('');
      setPaidAt('');
      setIncurredAt('');
      setCampaignInfluencerId(NONE);
      setNotes('');
      queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>{t('workspace.expenses.addExpenseTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label={t('fields.type')}>
          <Select value={type} onValueChange={(v) => setType(v as ExpenseType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_TYPES.map((et) => (
                <SelectItem key={et} value={et}>
                  {enumLabel(tEnums, 'expenseType', et)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('workspace.expenses.labelField')} hint={t('fields.optionalHint')}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('workspace.expenses.labelPlaceholder')} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('workspace.expenses.amountLabel')}>
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label={t('workspace.expenses.incurredOnLabel')} hint={t('fields.optionalHint')}>
            <Input type="date" value={incurredAt} onChange={(e) => setIncurredAt(e.target.value)} />
          </Field>
        </div>
        <Field label={t('fields.paymentStatus')}>
          <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as PaymentStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {enumLabel(tEnums, 'paymentStatus', s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <PaymentDetailFields
          paymentStatus={paymentStatus}
          paidAmount={paidAmount}
          onPaidAmount={setPaidAmount}
          paidAt={paidAt}
          onPaidAt={setPaidAt}
        />
        {influencers.length > 0 ? (
          <Field label={t('workspace.expenses.attributedInfluencerLabel')} hint={t('fields.optionalHint')}>
            <Select value={campaignInfluencerId} onValueChange={setCampaignInfluencerId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('workspace.expenses.noneOption')}</SelectItem>
                {influencers.map((ci) => (
                  <SelectItem key={ci.id} value={ci.id}>
                    <BidiText>{ci.influencer.displayName}</BidiText>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <Field label={t('fields.notes')} hint={t('fields.optionalHint')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </CardContent>
      <CardFooter>
        <Button className="w-full" disabled={!amount.trim() || addExpense.isPending} onClick={() => addExpense.mutate()}>
          {addExpense.isPending ? t('workspace.expenses.adding') : t('workspace.expenses.addExpenseTitle')}
        </Button>
      </CardFooter>
    </Card>
  );
}

export function CostsTab({
  campaignId,
  currency,
  influencers,
  costs,
}: {
  campaignId: string;
  currency: string;
  influencers: CampaignInfluencerDTO[];
  costs: { expenses: ExpenseDTO[]; summary: CostSummaryDTO };
}) {
  const t = useTranslations('campaigns');
  const canManage = useApp().can('FINANCE_MANAGE');
  const s = costs.summary;
  const overspent = (s.budgetUsedPercent ?? 0) > 100;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={t('fields.plannedBudget')}
          value={s.plannedBudget}
          icon={Target}
          tone="neutral"
          format={(n) => formatCurrency(n, s.currency)}
        />
        <StatCard
          label={t('workspace.expenses.totalSpend')}
          value={s.totalSpend}
          icon={Wallet}
          tone={overspent ? 'danger' : 'warning'}
          format={(n) => formatCurrency(n, s.currency)}
          hint={
            s.budgetUsedPercent != null
              ? t('workspace.expenses.percentOfBudget', { percent: formatPercent(s.budgetUsedPercent, 0) })
              : undefined
          }
        />
        <StatCard
          label={t('workspace.expenses.influencerFees')}
          value={s.influencerFees}
          icon={Coins}
          tone="info"
          format={(n) => formatCurrency(n, s.currency)}
        />
        <StatCard
          label={t('workspace.expenses.giftValueLabel')}
          value={s.giftValue}
          icon={Package}
          tone="accent"
          format={(n) => formatCurrency(n, s.currency)}
        />
        <StatCard
          label={t('workspace.expenses.otherExpenses')}
          value={s.otherExpenses}
          icon={Receipt}
          tone="neutral"
          format={(n) => formatCurrency(n, s.currency)}
        />
        <StatCard
          label={t('workspace.expenses.paidLabel')}
          value={s.paid}
          icon={CheckCircle2}
          tone="success"
          format={(n) => formatCurrency(n, s.currency)}
        />
        <StatCard
          label={t('workspace.expenses.unpaidLabel')}
          value={s.unpaid}
          icon={AlertCircle}
          tone="danger"
          format={(n) => formatCurrency(n, s.currency)}
        />
      </div>

      {s.plannedBudget != null ? (
        <Card>
          <CardContent className="p-5">
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">{t('workspace.expenses.budgetUtilization')}</span>
              <span className="text-muted-foreground">{formatPercent(s.budgetUsedPercent, 0)}</span>
            </div>
            <ProgressBar value={s.budgetUsedPercent ?? 0} tone={overspent ? 'danger' : 'primary'} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('workspace.expenses.expensesTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {costs.expenses.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title={t('workspace.expenses.emptyTitle')}
                description={t('workspace.expenses.emptyDescription')}
                className="border-0"
              />
            ) : (
              <div className="divide-y divide-border">
                {costs.expenses.map((e) => (
                  <ExpenseRow key={e.id} expense={e} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {canManage ? <AddExpenseForm campaignId={campaignId} currency={currency} influencers={influencers} /> : null}
      </div>

      <DeletedExpenses campaignId={campaignId} />
    </div>
  );
}
