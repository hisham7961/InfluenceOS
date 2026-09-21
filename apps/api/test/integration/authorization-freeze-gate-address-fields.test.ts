import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InfluencerDetailDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Security & Authorization Freeze Gate — LOGISTICS_ADDRESS_EDIT field-level
 * split, mixed-payload gap.
 *
 * apps/api/test/integration/logistics-address-capability-split.test.ts (a
 * prior agent in this same pass) already proves:
 *  - shipment.service.ts update(): a payload mixing a benign field (courier)
 *    with an address field (city) in ONE PATCH is rejected 403 for an actor
 *    holding LOGISTICS_MANAGE but not LOGISTICS_ADDRESS_EDIT ("a mixed
 *    payload ... also fails 403").
 *  - influencer.service.ts update(): an ADDRESS-ONLY payload (addressLine1
 *    alone, deliveryInstructions alone) is rejected 403 for the same actor
 *    shape, and a BENIGN-ONLY payload (displayName/category/city alone)
 *    succeeds.
 *
 * What it does NOT cover: a MIXED payload on influencer.service.ts's
 * update() — a benign field (displayName) and a shipping-address field
 * (addressLine1) in the SAME PATCH. touchesShippingAddressFields() in
 * influencer.service.ts uses `.some(...)`, exactly like shipment.service.ts's
 * touchesAddressFields(), so the mixing should be rejected the same way —
 * but that specific combination was never exercised end-to-end. This file
 * closes that one gap with a real API call, and confirms the rejection is
 * atomic (the benign field is not silently applied while the address field
 * is refused).
 */

const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

/** A STAFF user with a given Role Profile set BEFORE first login — a
 *  roleProfile PATCH after login revokes existing sessions (SEC-03), so
 *  logging in only once the profile is already set avoids that entirely.
 *  Mirrors logistics-address-capability-split.test.ts's createProfiledStaff. */
async function createProfiledStaff(
  app: FastifyInstance,
  admin: Record<string, string>,
  label: string,
  roleProfile: string,
): Promise<{ userId: string; auth: Record<string, string> }> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `sfg_addr_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({
    data: { email, name: `SFG-ADDR ${label}`, role: 'STAFF', passwordHash: await hash(password) },
  });
  await prisma.$disconnect();
  const patch = await app.inject({ method: 'PATCH', url: `/api/v1/users/${user.id}`, headers: admin, payload: { roleProfile } });
  if (patch.statusCode !== 200) throw new Error(`Failed to set roleProfile ${roleProfile}: ${patch.statusCode} ${patch.body}`);
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.statusCode} ${login.body}`);
  const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { userId: user.id, auth: { authorization: `Bearer ${token}` } };
}

describe('Security & Authorization Freeze Gate — LOGISTICS_ADDRESS_EDIT mixed-payload gap (influencer.service.ts)', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  let influencerManager: { userId: string; auth: Record<string, string> };
  let influencerId: string;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    // INFLUENCER_MANAGER: INFLUENCERS_MANAGE=yes, LOGISTICS_ADDRESS_EDIT=no
    // (capabilities.ts) — the exact actor shape the freeze-gate spec's §16
    // hard test calls for.
    influencerManager = await createProfiledStaff(app, admin, 'im', 'INFLUENCER_MANAGER');

    influencerId = idOf(
      await app.inject({
        method: 'POST',
        url: '/api/v1/influencers',
        headers: admin,
        payload: { displayName: `SFG-ADDR Creator ${Date.now()}`, countryCode: 'KW' },
      }),
    );
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
    await deleteUser(influencerManager.userId);
  });

  it(
    'a mixed payload (benign displayName + shipping-address addressLine1) in ONE PATCH is rejected 403 — mixing a benign ' +
      'field with an address field must not bypass LOGISTICS_ADDRESS_EDIT (the gap logistics-address-capability-split.test.ts ' +
      'left unexercised for the influencer path)',
    async () => {
      const before = (await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}`, headers: admin })).json() as InfluencerDetailDTO;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/influencers/${influencerId}`,
        headers: influencerManager.auth,
        payload: { displayName: 'Mixed Payload Attacker', addressLine1: 'Should Not Be Allowed Via Mixed Payload' },
      });
      expect(res.statusCode).toBe(403);

      // Atomicity: the whole PATCH must be refused — the benign displayName
      // must NOT have been silently applied while only the address field was
      // blocked.
      const after = (await app.inject({ method: 'GET', url: `/api/v1/influencers/${influencerId}`, headers: admin })).json() as InfluencerDetailDTO;
      expect(after.displayName).toBe(before.displayName);
      expect(after.addressLine1).not.toBe('Should Not Be Allowed Via Mixed Payload');
    },
  );

  it('the same mixed payload succeeds once the SAME actor is additionally granted LOGISTICS_ADDRESS_EDIT (positive control — isolates the capability, not the field mix, as the gate)', async () => {
    // Per-user capability override (PUT /users/:id/capabilities), on top of
    // the INFLUENCER_MANAGER Role Profile default — no session revocation on
    // this path (unlike a roleProfile change), so influencerManager's
    // existing token keeps working and picks up the new capability on the
    // very next request (hasCapability resolves live from the DB).
    const grant = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${influencerManager.userId}/capabilities`,
      headers: admin,
      payload: { overrides: [{ capability: 'LOGISTICS_ADDRESS_EDIT', granted: true }] },
    });
    expect(grant.statusCode).toBe(204);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/influencers/${influencerId}`,
      headers: influencerManager.auth,
      payload: { displayName: 'Mixed Payload OK', addressLine1: 'Corrected Street 1' },
    });
    expect(res.statusCode).toBe(200);
    const dto = res.json() as InfluencerDetailDTO;
    expect(dto.displayName).toBe('Mixed Payload OK');
    expect(dto.addressLine1).toBe('Corrected Street 1');
  });
});
