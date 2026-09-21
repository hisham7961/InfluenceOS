import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BulkPreviewDTO, BulkResultDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * OI-7 — Directory-wide bulk influencer actions (/influencers/bulk/preview
 * and /execute). plan() is the single source of truth both preview() and
 * execute() build on, so this proves the counts a manager confirms in
 * preview are exactly what execute() applies against real rows — and that
 * execute is admin-only (STAFF is refused with 403), never just a hidden button.
 */
async function createStaff(app: FastifyInstance, label: string): Promise<{ userId: string; auth: Record<string, string> }> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `staff_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({
    data: { email, name: `Staff ${label}`, role: 'STAFF', passwordHash: await hash(password) },
  });
  await prisma.$disconnect();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { userId: user.id, auth: { authorization: `Bearer ${token}` } };
}

describe('OI-7 — Bulk influencer-directory actions', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let staffId: string;
  let staff: Record<string, string>;
  let ownerId: string;
  let idA: string;
  let idB: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;
    ({ userId: staffId, auth: staff } = await createStaff(app, 'bulk'));
    // A second real user to be the target of ASSIGN_OWNER.
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const ownerUser = await prisma.user.create({
      data: { email: `owner_${Date.now()}@example.test`, name: 'Roster Owner', role: 'STAFF', passwordHash: await hash('Str0ng-Passw0rd!') },
    });
    ownerId = ownerUser.id;
    await prisma.$disconnect();

    idA = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `Bulk Creator A ${Date.now()}`, countryCode: 'KW' } }));
    idB = idOf(await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `Bulk Creator B ${Date.now()}`, countryCode: 'KW' } }));
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.influencer.deleteMany({ where: { id: { in: [idA, idB] } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
    await deleteUser(staffId);
    await deleteUser(ownerId);
  });

  it('preview() reports willUpdate/willSkip from real current state, without writing anything', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers/bulk/preview',
      headers: admin,
      payload: { action: 'ASSIGN_OWNER', influencerIds: [idA, idB], ownerId },
    });
    expect(res.statusCode).toBe(200);
    const preview = res.json() as BulkPreviewDTO;
    expect(preview.selected).toBe(2);
    expect(preview.willUpdate).toBe(2);
    expect(preview.willSkip).toBe(0);

    // Preview must never write — confirm neither influencer's owner changed.
    const check = await app.inject({ method: 'GET', url: `/api/v1/influencers/${idA}`, headers: admin });
    expect((check.json() as { ownerId: string | null }).ownerId).toBeNull();
  });

  it('execute() applies ASSIGN_OWNER for real, and a second run correctly skips the now-already-assigned row', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers/bulk/execute',
      headers: admin,
      payload: { action: 'ASSIGN_OWNER', influencerIds: [idA, idB], ownerId },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json() as BulkResultDTO;
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);

    const check = await app.inject({ method: 'GET', url: `/api/v1/influencers/${idA}`, headers: admin });
    expect((check.json() as { ownerId: string | null }).ownerId).toBe(ownerId);

    // Same call again: plan() sees the real, now-updated state and skips both.
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers/bulk/execute',
      headers: admin,
      payload: { action: 'ASSIGN_OWNER', influencerIds: [idA, idB], ownerId },
    });
    const againResult = again.json() as BulkResultDTO;
    expect(againResult.added).toBe(0);
    expect(againResult.skipped).toBe(2);
  });

  it('execute() ADD_TAG find-or-creates the tag and links it to real rows', async () => {
    const tagName = `bulk-tag-${Date.now()}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers/bulk/execute',
      headers: admin,
      payload: { action: 'ADD_TAG', influencerIds: [idA, idB], tagName },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json() as BulkResultDTO;
    expect(result.added).toBe(2);

    const check = await app.inject({ method: 'GET', url: `/api/v1/influencers/${idA}`, headers: admin });
    const tags = (check.json() as { tags: string[] }).tags;
    expect(tags).toContain(tagName);
  });

  it('execute() is admin-only — a STAFF actor is refused with 403, and nothing is applied', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers/bulk/execute',
      headers: staff,
      payload: { action: 'SET_RELATIONSHIP_STATUS', influencerIds: [idA], status: 'ACTIVE' },
    });
    expect(res.statusCode).toBe(403);

    const check = await app.inject({ method: 'GET', url: `/api/v1/influencers/${idA}`, headers: admin });
    expect((check.json() as { relationshipStatus: string }).relationshipStatus).not.toBe('ACTIVE');
  });

  it('preview() (dry-run only) is available to a non-admin STAFF actor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers/bulk/preview',
      headers: staff,
      payload: { action: 'SET_RELATIONSHIP_STATUS', influencerIds: [idA], status: 'ACTIVE' },
    });
    expect(res.statusCode).toBe(200);
  });
});
