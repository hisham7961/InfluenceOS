import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Relative import into the worker package (not an api dependency): vitest
// transforms the TS directly, so the real notification generator runs here
// against the shared test database.
import { generateNotifications } from '../../../worker/src/processors.ts';

/**
 * W3-2 — the worker's license-expiry pass. An ACTIVE license past its expiry is
 * swept to EXPIRED (the stored ledger stays truthful); an ACTIVE license inside
 * the 14-day window raises exactly one USAGE_RIGHT_EXPIRING notification, keyed
 * by targetUrl so a second pass does not duplicate it.
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
    const targetUrl = `/brands/${brandId}/usage-rights/${expiringId}`;
    await prisma.notification.deleteMany({ where: { targetUrl } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined); // cascades usage rights
    await prisma.$disconnect();
  });

  it('sweeps a lapsed license to EXPIRED and alerts once on the expiring one', async () => {
    await generateNotifications();

    const lapsed = await prisma.usageRight.findUnique({ where: { id: lapsedId } });
    expect(lapsed?.status).toBe('EXPIRED');

    const targetUrl = `/brands/${brandId}/usage-rights/${expiringId}`;
    const afterFirst = await prisma.notification.count({
      where: { category: 'USAGE_RIGHT_EXPIRING', targetUrl },
    });
    expect(afterFirst).toBe(1);

    // A second pass must not duplicate the alert (targetUrl dedup within ~20h).
    await generateNotifications();
    const afterSecond = await prisma.notification.count({
      where: { category: 'USAGE_RIGHT_EXPIRING', targetUrl },
    });
    expect(afterSecond).toBe(1);
  });
});
