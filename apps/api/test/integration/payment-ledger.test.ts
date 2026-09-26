import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  CampaignInfluencerDTO,
  CostSummaryDTO,
  ExpenseDTO,
  PayablesPageDTO,
  PaymentDTO,
  PaymentsPageDTO,
  UserDTO,
} from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P2.3 — the payment ledger. Payments are recorded against a creator's fee or
 * an expense, never deleted (voided instead), and the paid amount / status on
 * the fee or expense follow the ledger. Also: what is still owed, the expense
 * trash, and who may see or record money.
 */
describe('P2.3 — payment ledger, payables and expense trash', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let viewerFinance: Record<string, string>; // GENERAL_MANAGER: sees money, can't record it
  let viewerFinanceId: string;
  let noFinance: Record<string, string>; // OPERATIONS_MANAGER: no money at all
  let noFinanceId: string;
  let otherBrand: Record<string, string>;
  let otherBrandId: string;
  let brandId: string;
  let brandB: string;
  let campaignId: string;
  let influencerId: string;
  let rosterId: string;
  let expenseId: string;
  const tag = `PAY${Date.now()}`;
  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  async function createUser(label: string, roleProfile?: string): Promise<{ userId: string; auth: Record<string, string> }> {
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `${tag.toLowerCase()}_${label}_${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: { email, name: `${tag} ${label}`, role: 'STAFF', roleProfile: (roleProfile ?? null) as never, passwordHash: await hash(password) },
    });
    await prisma.$disconnect();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    const tokens = (res.json() as { tokens: { accessToken: string } }).tokens;
    return { userId: user.id, auth: { authorization: `Bearer ${tokens.accessToken}` } };
  }

  const roster = async () =>
    ((await app.inject({ method: 'GET', url: `/api/v1/campaign-influencers/${rosterId}`, headers: admin })).json() as CampaignInfluencerDTO);
  const costs = async () =>
    (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/costs`, headers: admin })).json() as {
      expenses: ExpenseDTO[];
      summary: CostSummaryDTO;
    };
  const payFee = (amount: number, auth = admin) =>
    app.inject({ method: 'POST', url: `/api/v1/campaign-influencers/${rosterId}/payments`, headers: auth, payload: { amount, method: 'BANK_TRANSFER', reference: 'TRX-1' } });

  beforeAll(async () => {
    app = await makeApp();
    ({ auth: admin, userId: adminId } = await loginFresh(app));
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `${tag} Brand` } }));
    brandB = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `${tag} Other` } }));
    campaignId = idOf(await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId, name: `${tag} Launch` } }));
    influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `${tag} Noor`, countryCode: 'KW' } }),
    );
    rosterId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/influencers`,
        headers: admin,
        payload: { influencerId, dealType: 'PAID', agreedCost: 1000 },
      }),
    );
    expenseId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/expenses`,
        headers: admin,
        payload: { type: 'PRODUCTION', label: `${tag} Studio`, amount: 300, currency: 'KWD' },
      }),
    );
    ({ userId: viewerFinanceId, auth: viewerFinance } = await createUser('gm', 'GENERAL_MANAGER'));
    ({ userId: noFinanceId, auth: noFinance } = await createUser('ops', 'OPERATIONS_MANAGER'));
    ({ userId: otherBrandId, auth: otherBrand } = await createUser('brand-b'));
    await app.inject({ method: 'PUT', url: `/api/v1/users/${otherBrandId}/brand-access`, headers: admin, payload: { brandIds: [brandB] } });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.payment.deleteMany({ where: { campaignId } }).catch(() => undefined);
    await prisma.campaign.deleteMany({ where: { brandId: { in: [brandId, brandB] } } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId: { in: [brandId, brandB] } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: [brandId, brandB] } } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { displayName: { startsWith: tag } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    for (const id of [viewerFinanceId, noFinanceId, otherBrandId, adminId]) await deleteUser(id);
  });

  it('records a part payment and derives the status from it', async () => {
    const res = await payFee(400);
    expect(res.statusCode).toBe(201);
    const p = res.json() as PaymentDTO;
    expect(p).toMatchObject({ kind: 'FEE', amount: 400, currency: 'KWD', method: 'BANK_TRANSFER', reference: 'TRX-1', voidedAt: null });
    expect(p.influencerName).toContain('Noor');
    const ci = await roster();
    expect(ci.paymentStatus).toBe('PARTIALLY_PAID');
    expect(ci.paidAmount).toBe(400);
    const { summary } = await costs();
    expect(summary.paid).toBe(400);
    expect(summary.unpaid).toBe(900); // 600 fee + 300 studio
  });

  it('refuses paying more than is owed, then pays the rest in full', async () => {
    const over = await payFee(700);
    expect(over.statusCode).toBe(409);
    expect((over.json() as { error: { message: string } }).error.message).toContain('600.000 KWD');
    expect((await payFee(600)).statusCode).toBe(201);
    expect((await roster()).paymentStatus).toBe('PAID');
    expect((await payFee(1)).statusCode).toBe(409);
  });

  it('voids a payment: it stays on record, stops counting, and the status follows', async () => {
    const list = (await app.inject({ method: 'GET', url: `/api/v1/finance/payments?campaignId=${campaignId}`, headers: admin })).json() as PaymentsPageDTO;
    expect(list.data).toHaveLength(2);
    expect(list.totals).toEqual([{ currency: 'KWD', amount: 1000 }]);
    const six = list.data.find((p) => p.amount === 600)!;

    expect((await app.inject({ method: 'POST', url: `/api/v1/payments/${six.id}/void`, headers: admin, payload: { reason: '' } })).statusCode).toBe(422);
    const voided = await app.inject({ method: 'POST', url: `/api/v1/payments/${six.id}/void`, headers: admin, payload: { reason: 'Entered twice' } });
    expect(voided.statusCode).toBe(200);
    expect((voided.json() as PaymentDTO).voidReason).toBe('Entered twice');
    expect((await app.inject({ method: 'POST', url: `/api/v1/payments/${six.id}/void`, headers: admin, payload: { reason: 'again' } })).statusCode).toBe(409);

    const ci = await roster();
    expect(ci.paymentStatus).toBe('PARTIALLY_PAID');
    expect(ci.paidAmount).toBe(400);
    const live = (await app.inject({ method: 'GET', url: `/api/v1/finance/payments?campaignId=${campaignId}`, headers: admin })).json() as PaymentsPageDTO;
    expect(live.data.map((p) => p.amount)).toEqual([400]);
    const all = (await app.inject({ method: 'GET', url: `/api/v1/finance/payments?campaignId=${campaignId}&includeVoided=true`, headers: admin })).json() as PaymentsPageDTO;
    expect(all.data).toHaveLength(2);
    expect(all.totals).toEqual([{ currency: 'KWD', amount: 400 }]);
  });

  it('the older "mark as paid" goes through the ledger, and cannot quietly lower what was paid', async () => {
    const paid = await app.inject({ method: 'PATCH', url: `/api/v1/campaign-influencers/${rosterId}`, headers: admin, payload: { paymentStatus: 'PAID' } });
    expect(paid.statusCode).toBe(200);
    expect((paid.json() as CampaignInfluencerDTO).paymentStatus).toBe('PAID');
    const list = (await app.inject({ method: 'GET', url: `/api/v1/finance/payments?campaignInfluencerId=${rosterId}`, headers: admin })).json() as PaymentsPageDTO;
    expect(list.data.map((p) => p.amount).sort()).toEqual([400, 600]);

    const lower = await app.inject({ method: 'PATCH', url: `/api/v1/campaign-influencers/${rosterId}`, headers: admin, payload: { paymentStatus: 'UNPAID' } });
    expect(lower.statusCode).toBe(409);
    expect((await roster()).paymentStatus).toBe('PAID');

    // A higher fee afterwards turns "paid" back into a part payment.
    await app.inject({ method: 'PATCH', url: `/api/v1/campaign-influencers/${rosterId}`, headers: admin, payload: { agreedCost: 1200 } });
    const ci = await roster();
    expect(ci.paymentStatus).toBe('PARTIALLY_PAID');
    expect(ci.paidAmount).toBe(1000);
  });

  it('lists what is still owed, with totals, filters and an Excel export', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/finance/payables?campaignId=${campaignId}`, headers: admin });
    expect(res.statusCode).toBe(200);
    const page = res.json() as PayablesPageDTO;
    const fee = page.data.find((r) => r.kind === 'FEE')!;
    expect(fee).toMatchObject({ id: rosterId, amount: 1200, paid: 1000, owed: 200, paymentsCount: 2 });
    const exp = page.data.find((r) => r.kind === 'EXPENSE')!;
    expect(exp).toMatchObject({ id: expenseId, owed: 300, paid: 0 });
    expect(page.totals).toEqual([{ currency: 'KWD', amount: 500 }]);

    const onlyExpenses = (await app.inject({ method: 'GET', url: `/api/v1/finance/payables?campaignId=${campaignId}&kind=EXPENSE`, headers: admin })).json() as PayablesPageDTO;
    expect(onlyExpenses.data.map((r) => r.id)).toEqual([expenseId]);
    const byName = (await app.inject({ method: 'GET', url: `/api/v1/finance/payables?q=${tag}%20Noor`, headers: admin })).json() as PayablesPageDTO;
    expect(byName.data.map((r) => r.id)).toEqual([rosterId]);

    const xlsx = await app.inject({ method: 'GET', url: `/api/v1/finance/payables/xlsx?campaignId=${campaignId}&locale=ar`, headers: admin });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    const px = await app.inject({ method: 'GET', url: `/api/v1/finance/payments/xlsx?campaignId=${campaignId}`, headers: admin });
    expect(px.statusCode).toBe(200);
  });

  it('pays an expense; a paid expense cannot be deleted; deleting goes to a restorable trash', async () => {
    const pay = await app.inject({ method: 'POST', url: `/api/v1/expenses/${expenseId}/payments`, headers: admin, payload: { amount: 100, method: 'CASH' } });
    expect(pay.statusCode).toBe(201);
    const payment = pay.json() as PaymentDTO;
    expect(payment).toMatchObject({ kind: 'EXPENSE', expenseType: 'PRODUCTION', amount: 100 });
    expect((await costs()).expenses.find((e) => e.id === expenseId)!.paymentStatus).toBe('PARTIALLY_PAID');

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/expenses/${expenseId}`, headers: admin })).statusCode).toBe(409);
    await app.inject({ method: 'POST', url: `/api/v1/payments/${payment.id}/void`, headers: admin, payload: { reason: 'Wrong expense' } });
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/expenses/${expenseId}`, headers: admin })).statusCode).toBe(204);

    const after = await costs();
    expect(after.expenses.some((e) => e.id === expenseId)).toBe(false);
    expect(after.summary.otherExpenses).toBe(0);
    const trash = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/expenses/trash`, headers: admin })).json() as ExpenseDTO[];
    expect(trash.map((e) => e.id)).toEqual([expenseId]);
    const owed = (await app.inject({ method: 'GET', url: `/api/v1/finance/payables?campaignId=${campaignId}`, headers: admin })).json() as PayablesPageDTO;
    expect(owed.data.some((r) => r.id === expenseId)).toBe(false);
    // Nothing can be paid against a trashed expense.
    expect((await app.inject({ method: 'POST', url: `/api/v1/expenses/${expenseId}/payments`, headers: admin, payload: { amount: 10 } })).statusCode).toBe(404);

    const restored = await app.inject({ method: 'POST', url: `/api/v1/expenses/${expenseId}/restore`, headers: admin });
    expect(restored.statusCode).toBe(200);
    expect((await costs()).summary.otherExpenses).toBe(300);
  });

  it("keeps a paid creator's roster row: removing them is refused", async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/campaign-influencers/${rosterId}`, headers: admin });
    expect(res.statusCode).toBe(409);
    expect((await roster()).id).toBe(rosterId);
  });

  it('only people who may see money see it, and only those who may record it can', async () => {
    // General manager: sees the ledger and payables, can't record or void.
    expect((await app.inject({ method: 'GET', url: `/api/v1/finance/payables`, headers: viewerFinance })).statusCode).toBe(200);
    expect((await payFee(10, viewerFinance)).statusCode).toBe(403);
    // Operations manager: no money at all.
    expect((await app.inject({ method: 'GET', url: `/api/v1/finance/payables`, headers: noFinance })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/v1/finance/payments`, headers: noFinance })).statusCode).toBe(403);
    // …nor a campaign's expenses and paid / unpaid totals.
    expect((await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/costs`, headers: noFinance })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}/costs`, headers: viewerFinance })).statusCode).toBe(200);
    // Another brand's user: sees nothing of this brand, can't pay into it.
    const other = (await app.inject({ method: 'GET', url: `/api/v1/finance/payments?campaignId=${campaignId}`, headers: otherBrand })).json() as PaymentsPageDTO;
    expect(other.data).toHaveLength(0);
    const otherOwed = (await app.inject({ method: 'GET', url: `/api/v1/finance/payables?brandId=${brandId}`, headers: otherBrand })).json() as PayablesPageDTO;
    expect(otherOwed.data).toHaveLength(0);
    expect((await payFee(10, otherBrand)).statusCode).toBe(404);
  });

  it('tells the signed-in user their own capabilities', async () => {
    const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: noFinance })).json() as UserDTO;
    expect(me.capabilities).toContain('CAMPAIGNS_VIEW');
    expect(me.capabilities).not.toContain('FINANCE_VIEW');
    const gm = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: viewerFinance })).json() as UserDTO;
    expect(gm.capabilities).toContain('FINANCE_VIEW');
    expect(gm.capabilities).not.toContain('FINANCE_MANAGE');
  });
});
