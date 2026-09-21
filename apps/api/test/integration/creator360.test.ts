import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CreatorReliabilityDTO, CreatorSnapshotDTO, CreatorTimelineItemDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * OI-4 — Creator 360: relationship snapshot, delivery reliability, and the
 * cross-source master timeline. Proves every figure is derived from real
 * rows (never a fabricated trust score) against a real campaign roster row,
 * two real deliverables (one on-time, one late), and a real note.
 */
describe('OI-4 — Creator 360', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let brandId: string;
  let campaignId: string;
  let influencerId: string;
  let ciId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const day = 864e5;
  const daysAgo = (n: number) => new Date(Date.now() - n * day).toISOString();

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
    brandId = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: auth, payload: { name: `C360 Brand ${Date.now()}` } }));
    campaignId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: auth, payload: { brandId, name: `C360 Camp ${Date.now()}`, currency: 'KWD' } }),
    );
    influencerId = idOf(
      await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: auth, payload: { displayName: `C360 Creator ${Date.now()}` } }),
    );
    ciId = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignId}/influencers`,
        headers: auth,
        payload: { influencerId, dealType: 'PAID', agreedCost: 500, currency: 'KWD', paidAmount: 200, paymentStatus: 'PARTIALLY_PAID' },
      }),
    );

    // On-time: due 10 days ago, published 12 days ago (before due).
    const d1 = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/deliverables`,
        headers: auth,
        payload: { platform: 'INSTAGRAM', type: 'REEL', dueDate: daysAgo(10) },
      }),
    );
    await app.inject({ method: 'PATCH', url: `/api/v1/deliverables/${d1}`, headers: auth, payload: { status: 'PUBLISHED', publishedAt: daysAgo(12) } });

    // Late by 3 days: due 5 days ago, published 2 days ago.
    const d2 = idOf(
      await app.inject({
        method: 'POST',
        url: `/api/v1/campaign-influencers/${ciId}/deliverables`,
        headers: auth,
        payload: { platform: 'TIKTOK', type: 'VIDEO', dueDate: daysAgo(5) },
      }),
    );
    await app.inject({ method: 'PATCH', url: `/api/v1/deliverables/${d2}`, headers: auth, payload: { status: 'PUBLISHED', publishedAt: daysAgo(2) } });

    await app.inject({ method: 'POST', url: '/api/v1/notes', headers: auth, payload: { influencerId, body: 'Great to work with, responsive.' } });
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('snapshot() derives real relationship figures, never a fabricated score', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/snapshot`, headers: auth });
    expect(res.statusCode).toBe(200);
    const snapshot = res.json() as CreatorSnapshotDTO;
    expect(snapshot.brandsWorkedWith).toBe(1);
    expect(snapshot.totalCollaborations).toBe(1);
    expect(snapshot.rateRange).toEqual({ min: 500, max: 500, currency: 'KWD' });
    expect(snapshot.outstandingPayment).toBe(300); // 500 agreed - 200 paid
    expect(snapshot.currency).toBe('KWD');
  });

  it('reliability() computes real onTime/late counts and average delay from real dueDate/publishedAt pairs', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/reliability`, headers: auth });
    expect(res.statusCode).toBe(200);
    const reliability = res.json() as CreatorReliabilityDTO;
    expect(reliability.sampleSize).toBe(2);
    expect(reliability.onTime).toBe(1);
    expect(reliability.late).toBe(1);
    expect(reliability.averageDelayDays).toBe(3);
  });

  it('timeline() merges real ActivityLog/Note/Submission rows into one feed', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}/timeline`, headers: auth });
    expect(res.statusCode).toBe(200);
    const timeline = res.json() as { data: CreatorTimelineItemDTO[] };
    // The raw Note itself (id prefixed 'note:') carries the real body — a
    // separate ActivityLog-derived 'collaboration' item ("X added a note.")
    // also appears by design (note.service.ts logs plain influencer notes to
    // ActivityLog too), so match on the note-specific id, not just bucket.
    const noteItem = timeline.data.find((i) => i.id.startsWith('note:'));
    expect(noteItem).toBeDefined();
    expect(noteItem!.bucket).toBe('collaboration');
    expect(noteItem!.message).toContain('Great to work with');
    // Real campaign-roster/deliverable activity should also show up.
    expect(timeline.data.some((i) => i.bucket === 'campaign' || i.bucket === 'content')).toBe(true);
  });
});
