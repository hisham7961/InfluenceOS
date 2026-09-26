import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requests, z, type PayableDTO, type PaymentDTO } from '@influenceos/contracts';
import { requireAuth, servicesFor } from '../http';
import { payablesXlsx, paymentsXlsx } from '../lib/finance-xlsx';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXPORT_PAGES = 50; // 5,000 rows

const localeQuery = z.object({ locale: z.enum(['en', 'ar']).default('en') });

/**
 * P2.3 — the payment ledger and what is still owed. Reading needs
 * FINANCE_VIEW; recording or voiding a payment, and the expense trash,
 * FINANCE_MANAGE. Everything stays inside the caller's brand scope.
 */
export async function financeRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/finance/payables',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Finance'],
        summary: 'Creator fees and expenses with money still owed, oldest due first, with the total owed per currency',
        querystring: requests.payablesQuerySchema,
      },
    },
    async (req) => servicesFor(req).payments.payables(req.query),
  );

  r.get(
    '/finance/payables/xlsx',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Finance'],
        summary: 'What is still owed, as an Excel workbook (same filters)',
        querystring: requests.payablesQuerySchema.omit({ page: true, pageSize: true }).merge(localeQuery),
      },
    },
    async (req, reply) => {
      const service = servicesFor(req).payments;
      const rows: PayableDTO[] = [];
      let totals: { currency: string; amount: number }[] = [];
      for (let page = 1; page <= EXPORT_PAGES; page++) {
        const res = await service.payables({ ...req.query, page, pageSize: 100 });
        rows.push(...res.data);
        totals = res.totals;
        if (page >= res.pagination.totalPages) break;
      }
      reply
        .header('Content-Type', XLSX)
        .header('Content-Disposition', `attachment; filename="to-pay-${new Date().toISOString().slice(0, 10)}.xlsx"`)
        .header('Cache-Control', 'private, no-store');
      return reply.send(payablesXlsx(rows, totals, req.query.locale));
    },
  );

  r.get(
    '/finance/payments',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Finance'],
        summary: 'The payment ledger, newest first, with the total paid per currency (voided payments left out unless asked)',
        querystring: requests.paymentsQuerySchema,
      },
    },
    async (req) => servicesFor(req).payments.list(req.query),
  );

  r.get(
    '/finance/payments/xlsx',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Finance'],
        summary: 'The payment ledger as an Excel workbook (same filters)',
        querystring: requests.paymentsQuerySchema.omit({ page: true, pageSize: true }).merge(localeQuery),
      },
    },
    async (req, reply) => {
      const service = servicesFor(req).payments;
      const rows: PaymentDTO[] = [];
      let totals: { currency: string; amount: number }[] = [];
      for (let page = 1; page <= EXPORT_PAGES; page++) {
        const res = await service.list({ ...req.query, page, pageSize: 100 });
        rows.push(...res.data);
        totals = res.totals;
        if (page >= res.pagination.totalPages) break;
      }
      reply
        .header('Content-Type', XLSX)
        .header('Content-Disposition', `attachment; filename="payments-${new Date().toISOString().slice(0, 10)}.xlsx"`)
        .header('Cache-Control', 'private, no-store');
      return reply.send(paymentsXlsx(rows, totals, req.query.locale));
    },
  );

  r.get(
    '/finance/payments/:id',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Finance'], summary: 'One payment', params: z.object({ id: z.string() }) },
    },
    async (req) => servicesFor(req).payments.get(req.params.id),
  );

  r.post(
    '/campaign-influencers/:id/payments',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Finance'],
        summary: "Record a payment against a creator's fee on a campaign",
        params: z.object({ id: z.string() }),
        body: requests.paymentCreateSchema,
      },
    },
    async (req, reply) => {
      const payment = await servicesFor(req).payments.recordForFee(req.params.id, req.body);
      reply.status(201);
      return payment;
    },
  );

  r.post(
    '/expenses/:id/payments',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Finance'],
        summary: 'Record a payment against an expense',
        params: z.object({ id: z.string() }),
        body: requests.paymentCreateSchema,
      },
    },
    async (req, reply) => {
      const payment = await servicesFor(req).payments.recordForExpense(req.params.id, req.body);
      reply.status(201);
      return payment;
    },
  );

  r.post(
    '/payments/:id/void',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Finance'],
        summary: 'Void a payment recorded by mistake (it stays on record, marked voided, and stops counting)',
        params: z.object({ id: z.string() }),
        body: requests.paymentVoidSchema,
      },
    },
    async (req) => servicesFor(req).payments.void(req.params.id, req.body.reason),
  );

  r.get(
    '/campaigns/:id/expenses/trash',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Finance'], summary: "A campaign's deleted expenses (restorable)", params: z.object({ id: z.string() }) },
    },
    async (req) => servicesFor(req).expenses.listTrash(req.params.id),
  );

  r.post(
    '/expenses/:id/restore',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Finance'], summary: 'Restore a deleted expense from the trash', params: z.object({ id: z.string() }) },
    },
    async (req) => servicesFor(req).expenses.restore(req.params.id),
  );
}
