import { guessDelimiter, parseCsv } from '@influenceos/shared';

/**
 * Reading a shop's order export in the browser (P3.1): the table, and which
 * column holds what. The cells are sent as they are — the server reads
 * dates, amounts and codes (Arabic digits, Gulf currencies, day-first dates).
 */

export const SALE_FIELDS = ['orderRef', 'date', 'amount', 'currency', 'code', 'link', 'orders', 'status'] as const;
export type SaleField = (typeof SALE_FIELDS)[number];
export type ColumnMap = Partial<Record<SaleField, number>>;

export const MAX_SALE_ROWS = 20_000;

// Header words that usually mean each field (English, Arabic; Shopify, Salla,
// Zid), best match first — "Discount Code" wins over "Discount Amount".
const ALIASES: Record<SaleField, RegExp[]> = {
  orderRef: [/^(order ?(id|no|number|#)|رقم الطلب|رقم الفاتورة)$/i, /^(name|order|reference|الطلب)$/i],
  date: [/^(date|order date|created at|التاريخ|تاريخ الطلب)$/i, /(created|paid at|processed|date|تاريخ)/i],
  amount: [
    /^(total|order total|total price|grand total|المبلغ|الإجمالي|الاجمالي|المجموع|قيمة الطلب)$/i,
    /^(amount|revenue|sales|net sales)$/i,
  ],
  currency: [/^(currency|العملة)$/i],
  // Not "Postal code": only discount-ish code columns.
  code: [/(discount ?code|coupon|promo|voucher|^code$|^الكود$|كود الخصم|كوبون)/i, /(discount|خصم)/i],
  link: [/(utm|landing|referr|الرابط)/i, /^(link|url)$/i],
  orders: [/^(orders|order count|number of orders|عدد الطلبات)$/i],
  status: [/^(status|financial status|payment status|الحالة|حالة الطلب)$/i, /(status|الحالة)/i],
};

/** Best guess of which column holds each field. */
export function guessColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<number>();
  for (const field of SALE_FIELDS) {
    for (const re of ALIASES[field]) {
      const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(h.trim()));
      if (i >= 0) {
        map[field] = i;
        used.add(i);
        break;
      }
    }
  }
  return map;
}

export interface SalesTable {
  headers: string[];
  rows: string[][];
}

/** A CSV/TSV file or rows pasted from Excel, header first. */
export function readSalesTable(text: string): SalesTable {
  const matrix = parseCsv(text, guessDelimiter(text));
  const [headers = [], ...rows] = matrix;
  return { headers: headers.map((h) => h.trim()), rows: rows.filter((r) => r.some((c) => c.trim() !== '')) };
}

/** The rows as the API takes them. */
export function toImportRows(table: SalesTable, map: ColumnMap) {
  const cell = (row: string[], field: SaleField) => {
    const i = map[field];
    return i === undefined ? null : (row[i] ?? '').trim() || null;
  };
  return table.rows.map((row) => ({
    orderRef: cell(row, 'orderRef'),
    date: cell(row, 'date'),
    amount: cell(row, 'amount'),
    currency: cell(row, 'currency'),
    code: cell(row, 'code'),
    link: cell(row, 'link'),
    orders: cell(row, 'orders'),
    status: cell(row, 'status'),
  }));
}
