import type { PayableDTO, PaymentDTO } from '@influenceos/contracts';
import { buildXlsx, type Cell } from './xlsx';

type Locale = 'en' | 'ar';

const LABELS = {
  en: {
    payables: 'To pay',
    payments: 'Payments',
    campaign: 'Campaign',
    brand: 'Brand',
    payee: 'Creator / item',
    kind: 'Type',
    fee: 'Creator fee',
    expense: 'Expense',
    amount: 'Amount',
    paid: 'Paid',
    owed: 'Still owed',
    currency: 'Currency',
    due: 'Due',
    lastPaid: 'Last paid',
    date: 'Date',
    method: 'Method',
    reference: 'Reference',
    notes: 'Notes',
    recordedBy: 'Recorded by',
    voided: 'Voided',
    total: 'Total',
  },
  ar: {
    payables: 'المستحقات',
    payments: 'المدفوعات',
    campaign: 'الحملة',
    brand: 'العلامة التجارية',
    payee: 'المؤثر / البند',
    kind: 'النوع',
    fee: 'أجر مؤثر',
    expense: 'مصروف',
    amount: 'المبلغ',
    paid: 'المدفوع',
    owed: 'المتبقي',
    currency: 'العملة',
    due: 'تاريخ الاستحقاق',
    lastPaid: 'آخر دفعة',
    date: 'التاريخ',
    method: 'طريقة الدفع',
    reference: 'المرجع',
    notes: 'ملاحظات',
    recordedBy: 'سجّلها',
    voided: 'ملغاة',
    total: 'الإجمالي',
  },
} as const;

const METHOD = {
  en: { BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CHEQUE: 'Cheque', CARD: 'Card', PAYMENT_LINK: 'Payment link', OTHER: 'Other' },
  ar: { BANK_TRANSFER: 'تحويل بنكي', CASH: 'نقدًا', CHEQUE: 'شيك', CARD: 'بطاقة', PAYMENT_LINK: 'رابط دفع', OTHER: 'أخرى' },
} as const;

const day = (v: string | null) => (v ? v.slice(0, 10) : '');
const header = (labels: string[]): Cell[] => labels.map((h) => ({ value: h, style: 'header' as const }));

/** What is still owed, as an Excel sheet (with a total per currency). */
export function payablesXlsx(rows: PayableDTO[], totals: { currency: string; amount: number }[], locale: Locale): Buffer {
  const L = LABELS[locale];
  const data: Cell[][] = [
    header([L.campaign, L.brand, L.payee, L.kind, L.amount, L.paid, L.owed, L.currency, L.due, L.lastPaid]),
    ...rows.map((r): Cell[] => [
      r.campaignName,
      r.brandName,
      r.influencerName ?? r.label ?? '',
      r.kind === 'FEE' ? L.fee : L.expense,
      { value: r.amount, style: 'money' },
      { value: r.paid, style: 'money' },
      { value: r.owed, style: 'money' },
      r.currency,
      day(r.dueAt),
      day(r.lastPaidAt),
    ]),
    [],
    ...totals.map((t): Cell[] => [{ value: L.total, style: 'bold' }, '', '', '', '', '', { value: t.amount, style: 'money' }, t.currency]),
  ];
  return buildXlsx([
    { name: L.payables, rows: data, widths: [28, 20, 26, 14, 14, 14, 14, 10, 12, 12], freezeRow: 2, rtl: locale === 'ar' },
  ]);
}

/** The payment ledger, as an Excel sheet (voided payments marked, not counted in the total). */
export function paymentsXlsx(rows: PaymentDTO[], totals: { currency: string; amount: number }[], locale: Locale): Buffer {
  const L = LABELS[locale];
  const data: Cell[][] = [
    header([L.date, L.campaign, L.brand, L.payee, L.kind, L.amount, L.currency, L.method, L.reference, L.notes, L.recordedBy, L.voided]),
    ...rows.map((p): Cell[] => [
      day(p.paidAt),
      p.campaignName,
      p.brandName,
      p.influencerName ?? p.expenseLabel ?? '',
      p.kind === 'FEE' ? L.fee : L.expense,
      { value: p.amount, style: 'money' },
      p.currency,
      METHOD[locale][p.method],
      p.reference ?? '',
      p.notes ?? '',
      p.recordedByName ?? '',
      p.voidedAt ? `${day(p.voidedAt)} — ${p.voidReason ?? ''}` : '',
    ]),
    [],
    ...totals.map((t): Cell[] => [{ value: L.total, style: 'bold' }, '', '', '', '', { value: t.amount, style: 'money' }, t.currency]),
  ];
  return buildXlsx([
    { name: L.payments, rows: data, widths: [12, 28, 20, 26, 14, 14, 10, 16, 20, 30, 18, 30], freezeRow: 2, rtl: locale === 'ar' },
  ]);
}
