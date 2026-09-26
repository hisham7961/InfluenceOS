import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Relative import into the worker package (not an api dependency): vitest
// transforms the TS directly, so the real notification generator runs here
// against the shared test database.
import { generateNotifications } from '../../../worker/src/processors.ts';

/**
 * W3-2 — the worker's license-expiry pass. An ACTIVE license past its expiry is
 * swept to EXPIRED (the stored ledger stays truthful); an ACTIVE license inside
 * the 14-day window raises exactly one USAGE_RIGHT_EXPIRING notification, keyed
 * by licence and expiry date so a second pass does not duplicate it, linking
 * to the brand's usage-rights card (P2.6 — the old link was a 404).
 */
describe('W3-2 — worker usage-rights expiry sweep + alert', () => {
  let prisma: import('@influenceos/database').PrismaClient;
  let brandId: string;
  let expiringId: string;
  let lapsedId: string;

  const day = 864e5;

  beforeAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    const brand = await prisma.brand.create({
      data: { name: `URWorker ${Date.now()}`, slug: `urworker-${Date.now()}` },
    });
    brandId = brand.id;
    const expiring = await prisma.usageRight.create({
      data: { brandId, usageType: 'PAID_ADS', status: 'ACTIVE', expiresAt: new Date(Date.now() + 5 * day) },
    });
    expiringId = expiring.id;
    const lapsed = await prisma.usageRight.create({
      data: { brandId, usageType: 'ORGANIC', status: 'ACTIVE', expiresAt: new Date(Date.now() - 2 * day) },
    });
    lapsedId = lapsed.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined); // cascades usage rights
    await prisma.$disconnect();
  });

  it('sweeps a lapsed license to EXPIRED and alerts once on the expiring one', async () => {
    await generateNotifications();

    const lapsed = await prisma.usageRight.findUnique({ where: { id: lapsedId } });
    expect(lapsed?.status).toBe('EXPIRED');

    const alerts = await prisma.notification.findMany({ where: { category: 'USAGE_RIGHT_EXPIRING', brandId } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.targetUrl).toBe(`/brands/${brandId}#usage-rights`);
    expect(alerts[0]!.dedupeKey).toMatch(new RegExp(`^usage-right-expiring:${expiringId}:\\d{4}-\\d{2}-\\d{2}$`));

    // A second pass must not duplicate the alert.
    await generateNotifications();
    const afterSecond = await prisma.notification.count({ where: { category: 'USAGE_RIGHT_EXPIRING', brandId } });
    expect(afterSecond).toBe(1);

    // Extending the licence warns again when the new date comes near.
    await prisma.usageRight.update({ where: { id: expiringId }, data: { expiresAt: new Date(Date.now() + 9 * day) } });
    await generateNotifications();
    const afterExtend = await prisma.notification.count({ where: { category: 'USAGE_RIGHT_EXPIRING', brandId } });
    expect(afterExtend).toBe(2);
  });
});
