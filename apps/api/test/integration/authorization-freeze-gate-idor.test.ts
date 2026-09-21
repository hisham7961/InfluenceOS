import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  CampaignDetailDTO,
  CampaignInfluencerDTO,
  CampaignSummaryDTO,
  ExpenseDTO,
  Paginated,
} from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Security & Authorization Freeze Gate — direct-ID / IDOR test matrix
 * (spec sections 32-35, 68-76), scoped to the 5 resources whose brand/
 * country-scope and capability fixes are confirmed complete on this branch:
 * Campaign, CampaignInfluencer, CampaignExpense, ProductShipment
 * (LOGISTICS_ADDRESS_EDIT split — see the companion
 * authorization-freeze-gate-address-fields.test.ts) and Influencer
 * (shipping-address-field guard — also in the companion file).
 *
 * The spec's own words: "Test denials, not only successes. A test suite
 * where every request expects 200 does not prove authorization." Every
 * `it` below therefore asserts a precise HTTP status on a DENIAL — 404 for
 * an out-of-scope direct-ID reach (AppError.notFound maps to 404 via
 * HTTP_STATUS_FOR_CODE, packages/contracts/src/errors.ts), 403 for a
 * missing capability, 400 for a cross-parent child-id mismatch — never a
 * loosened assertion, and every denial is paired with a positive control
 * proving the SAME actor/capability succeeds once scope actually matches
 * (so a passing "expects 404" test can only mean the scope check fired,
 * not that the whole route is broken).
 *
 * This file does not repeat scenarios apps/api/test/integration/
 * security-freeze-gate-child-scope.test.ts (sourcing/note/usage-right),
 * brand-scope.test.ts, brand-isolation.test.ts,
 * content-shipment-brand-scope.test.ts or influencer-country-scope.test.ts
 * already cover — none of those touch Campaign/CampaignInfluencer/Expense
 * direct-ID IDOR, campaign-influencer.service.ts's per-row country check on
 * add(), or the combined brand+country AND-not-OR matrix, which is what
 * this file is for.
 */

const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

interface ScopedUser {
  userId: string;
  auth: Record<string, string>;
}

/** A throwaway user, logged in immediately, with no RoleProfile (legacy
 *  STAFF — every operational capability except USERS_MANAGE/ROLES_MANAGE/
 *  SYSTEM_SETTINGS_MANAGE/INTEGRATIONS_MANAGE, per capabilities.ts) unless
 *  `roleProfile` narrows it. Brand/country scope, if any, is applied by the
 *  caller via the admin brand-access/country-access endpoints afterward. */
async function createUser(
  app: FastifyInstance,
  label: string,
  roleProfile?: string,
): Promise<ScopedUser> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `sfg_idor_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({
    data: { email, name: `SFG-IDOR ${label}`, role: 'STAFF', roleProfile: (roleProfile as never) ?? null, passwordHash: await hash(password) },
  });
  await prisma.$disconnect();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
  const token = (res.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { userId: user.id, auth: { authorization: `Bearer ${token}` } };
}

async function setBrandAccess(app: FastifyInstance, admin: Record<string, string>, userId: string, brandIds: string[]) {
  const res = await app.inject({ method: 'PUT', url: `/api/v1/users/${userId}/brand-access`, headers: admin, payload: { brandIds } });
  if (res.statusCode !== 200) throw new Error(`brand-access failed: ${res.statusCode} ${res.body}`);
}

async function setCountryAccess(app: FastifyInstance, admin: Record<string, string>, userId: string, countryCodes: string[]) {
  const res = await app.inject({ method: 'PUT', url: `/api/v1/users/${userId}/country-access`, headers: admin, payload: { countryCodes } });
  if (res.statusCode !== 200) throw new Error(`country-access failed: ${res.statusCode} ${res.body}`);
}

describe('Security & Authorization Freeze Gate — direct-ID IDOR matrix (Campaign, CampaignInfluencer, CampaignExpense)', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;

  const tag = `SFG-IDOR-${Date.now()}`;

  // Brand X / Brand Y — the classic two-tenant IDOR setup. All "in-scope"
  // fixtures live under Brand X; all "out-of-scope" fixtures live under
  // Brand Y.
  let brandX: string;
  let brandY: string;
  let campaignX: string; // Brand X — in scope for brandOnlyStaff
  let campaignX2: string; // A second Brand X campaign — used only to prove
  // the child/parent check fires on cross-CAMPAIGN mismatch even when both
  // campaigns share the same (in-scope) brand.
  let campaignY: string; // Brand Y — out of scope for brandOnlyStaff
  let ciX: string; // CampaignInfluencer on campaignX
  let ciX2: string; // CampaignInfluencer on campaignX2 (same brand, different campaign)
  let ciY: string; // CampaignInfluencer on campaignY
  let expenseX: string; // Expense on campaignX
  let expenseY: string; // Expense on campaignY
  let influencerShared: string; // KW influencer used across ciX/ciX2/ciY (different campaignIds, so no dup conflict)
  let influencerKW: string; // KW influencer, free of any campaign — used by the add()/country-scope tests
  let influencerAE: string; // AE (out-of-country) influencer — used by the add()/country-scope tests

  // brandOnlyStaff: legacy STAFF (full capabilities), scoped to Brand X only,
  // no country restriction — isolates the BRAND scope check.
  let brandOnlyStaff: ScopedUser;
  // viewerBrandStaff: VIEWER Role Profile (CAMPAIGNS_VIEW only, no
  // CAMPAIGNS_MANAGE), scoped to Brand X — proves capability still gates an
  // in-scope mutation ("capability grants WHAT, scope grants WHERE").
  let viewerBrandStaff: ScopedUser;
  // countryOnlyStaff: legacy STAFF, scoped to country KW only, no brand
  // restriction — isolates the COUNTRY scope check on
  // campaign-influencer.service.ts's add().
  let countryOnlyStaff: ScopedUser;
  // matrixStaff: legacy STAFF, scoped to Brand X AND country KW — the
  // combined-attack-matrix actor (proves AND, not OR).
  let matrixStaff: ScopedUser;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;

    [brandX, brandY] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `${tag} Brand X` } }).then(idOf),
      app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `${tag} Brand Y` } }).then(idOf),
    ]);

    [campaignX, campaignX2, campaignY] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandX, name: `${tag} Camp X` } }).then(idOf),
      app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandX, name: `${tag} Camp X2` } }).then(idOf),
      app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandY, name: `${tag} Camp Y` } }).then(idOf),
    ]);

    [influencerShared, influencerKW, influencerAE] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `${tag} Shared`, countryCode: 'KW' } }).then(idOf),
      app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `${tag} KW`, countryCode: 'KW' } }).then(idOf),
      app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `${tag} AE`, countryCode: 'AE' } }).then(idOf),
    ]);

    // Sequential, not Promise.all: concurrent add() calls for the SAME
    // influencer (brandInfluencer.upsert keyed on brandId+influencerId, see
    // campaign-influencer.service.ts) race against each other under
    // concurrent load — a data-race wrinkle unrelated to authorization, but
    // real enough to break fixture setup if these run in parallel. Kept
    // sequential here purely for deterministic fixtures.
    ciX = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignX}/influencers`, headers: admin, payload: { influencerId: influencerShared, dealType: 'FREE' } }),
    );
    ciX2 = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignX2}/influencers`, headers: admin, payload: { influencerId: influencerShared, dealType: 'FREE' } }),
    );
    ciY = idOf(
      await app.inject({ method: 'POST', url: `/api/v1/campaigns/${campaignY}/influencers`, headers: admin, payload: { influencerId: influencerShared, dealType: 'FREE' } }),
    );

    [expenseX, expenseY] = await Promise.all([
      app
        .inject({ method: 'POST', url: `/api/v1/campaigns/${campaignX}/expenses`, headers: admin, payload: { type: 'OTHER', amount: 100, currency: 'KWD' } })
        .then(idOf),
      app
        .inject({ method: 'POST', url: `/api/v1/campaigns/${campaignY}/expenses`, headers: admin, payload: { type: 'OTHER', amount: 100, currency: 'KWD' } })
        .then(idOf),
    ]);

    [brandOnlyStaff, viewerBrandStaff, countryOnlyStaff, matrixStaff] = await Promise.all([
      createUser(app, 'brand-only'),
      createUser(app, 'viewer-brand', 'VIEWER'),
      createUser(app, 'country-only'),
      createUser(app, 'matrix'),
    ]);
    await Promise.all([
      setBrandAccess(app, admin, brandOnlyStaff.userId, [brandX]),
      setBrandAccess(app, admin, viewerBrandStaff.userId, [brandX]),
      setCountryAccess(app, admin, countryOnlyStaff.userId, ['KW']),
      setBrandAccess(app, admin, matrixStaff.userId, [brandX]),
      setCountryAccess(app, admin, matrixStaff.userId, ['KW']),
    ]);
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.campaign.deleteMany({ where: { brandId: { in: [brandX, brandY] } } }).catch(() => undefined);
    await prisma.brandInfluencer.deleteMany({ where: { brandId: { in: [brandX, brandY] } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: [brandX, brandY] } } }).catch(() => undefined);
    await prisma.influencer.deleteMany({ where: { id: { in: [influencerShared, influencerKW, influencerAE] } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(adminId);
    await deleteUser(brandOnlyStaff.userId);
    await deleteUser(viewerBrandStaff.userId);
    await deleteUser(countryOnlyStaff.userId);
    await deleteUser(matrixStaff.userId);
  });

  describe('Campaign — direct-ID GET/PATCH/POST IDOR (campaign.service.ts)', () => {
    it('GET an out-of-scope-brand campaign by direct id 404s — never a data leak, never 200', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignY}`, headers: brandOnlyStaff.auth });
      expect(res.statusCode).toBe(404);
    });

    it('positive control: the SAME actor reaches their own in-scope campaign by direct id (200) — proves the 404 above is scope, not a broken route', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignX}`, headers: brandOnlyStaff.auth });
      expect(res.statusCode).toBe(200);
      expect((res.json() as CampaignDetailDTO).id).toBe(campaignX);
    });

    it('PATCH an out-of-scope-brand campaign 404s and leaves it unchanged — capability grants WHAT, scope grants WHERE, both required', async () => {
      const res = await app.inject({ method: 'PATCH', url: `/api/v1/campaigns/${campaignY}`, headers: brandOnlyStaff.auth, payload: { name: 'HACKED' } });
      expect(res.statusCode).toBe(404);

      const after = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignY}`, headers: admin })).json() as CampaignDetailDTO;
      expect(after.name).not.toBe('HACKED');
    });

    it('PATCH the actor\'s own in-scope campaign succeeds (200) — the same capability, applied where scope actually matches', async () => {
      const res = await app.inject({ method: 'PATCH', url: `/api/v1/campaigns/${campaignX}`, headers: brandOnlyStaff.auth, payload: { description: 'Updated by brand-only staff' } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as CampaignDetailDTO).description).toBe('Updated by brand-only staff');
    });

    it('a VIEWER scoped to the SAME in-scope brand still gets 403 on PATCH — capability, not scope, is the gate here', async () => {
      const res = await app.inject({ method: 'PATCH', url: `/api/v1/campaigns/${campaignX}`, headers: viewerBrandStaff.auth, payload: { description: 'should never land' } });
      expect(res.statusCode).toBe(403);
    });

    it('CREATE with a capability present but an out-of-scope brandId in the body 404s — capability alone must never authorize an out-of-scope create', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        headers: brandOnlyStaff.auth,
        payload: { brandId: brandY, name: `${tag} Forged Campaign` },
      });
      expect(res.statusCode).toBe(404);

      // Confirm nothing was actually created under Brand Y by this actor.
      const listY = (await app.inject({ method: 'GET', url: `/api/v1/campaigns?brandId=${brandY}&pageSize=100`, headers: admin })).json() as Paginated<CampaignSummaryDTO>;
      expect(listY.data.some((c) => c.name === `${tag} Forged Campaign`)).toBe(false);
    });

    it('CREATE with the actor\'s own in-scope brandId succeeds (201) — same capability, in-scope brand', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        headers: brandOnlyStaff.auth,
        payload: { brandId: brandX, name: `${tag} Legit Campaign` },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as CampaignDetailDTO).brandId).toBe(brandX);
    });
  });

  describe('CampaignInfluencer — direct-ID GET/PATCH IDOR (campaign-influencer.service.ts)', () => {
    it('GET an out-of-scope-brand campaign influencer by direct id 404s (child resource, parent brand out of scope)', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/campaign-influencers/${ciY}`, headers: brandOnlyStaff.auth });
      expect(res.statusCode).toBe(404);
    });

    it('positive control: the same actor reaches their own in-scope campaign influencer (200)', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/campaign-influencers/${ciX}`, headers: brandOnlyStaff.auth });
      expect(res.statusCode).toBe(200);
      expect((res.json() as CampaignInfluencerDTO).id).toBe(ciX);
    });

    it('PATCH an out-of-scope-brand campaign influencer 404s and leaves it unchanged', async () => {
      const res = await app.inject({ method: 'PATCH', url: `/api/v1/campaign-influencers/${ciY}`, headers: brandOnlyStaff.auth, payload: { notes: 'HACKED' } });
      expect(res.statusCode).toBe(404);

      const after = (await app.inject({ method: 'GET', url: `/api/v1/campaign-influencers/${ciY}`, headers: admin })).json() as CampaignInfluencerDTO;
      expect(after.notes).not.toBe('HACKED');
    });

    it('PATCH the actor\'s own in-scope campaign influencer succeeds (200)', async () => {
      const res = await app.inject({ method: 'PATCH', url: `/api/v1/campaign-influencers/${ciX}`, headers: brandOnlyStaff.auth, payload: { notes: 'Updated by brand-only staff' } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as CampaignInfluencerDTO).notes).toBe('Updated by brand-only staff');
    });
  });

  describe('CampaignExpense — direct-ID GET(list)/PATCH IDOR + child/parent consistency (expense.service.ts)', () => {
    it('listing expenses for an out-of-scope-brand campaign 404s (GET /campaigns/:id/costs)', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignY}/costs`, headers: brandOnlyStaff.auth });
      expect(res.statusCode).toBe(404);
    });

    it('positive control: listing expenses for the actor\'s own in-scope campaign succeeds and returns its expense', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignX}/costs`, headers: brandOnlyStaff.auth });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { expenses: ExpenseDTO[] };
      expect(body.expenses.some((e) => e.id === expenseX)).toBe(true);
    });

    it('PATCH an out-of-scope-brand expense by direct id 404s and leaves it unchanged', async () => {
      const res = await app.inject({ method: 'PATCH', url: `/api/v1/expenses/${expenseY}`, headers: brandOnlyStaff.auth, payload: { notes: 'HACKED' } });
      expect(res.statusCode).toBe(404);

      const after = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignY}/costs`, headers: admin })).json() as { expenses: ExpenseDTO[] };
      expect(after.expenses.find((e) => e.id === expenseY)?.notes).not.toBe('HACKED');
    });

    it('PATCH the actor\'s own in-scope expense succeeds (200)', async () => {
      const res = await app.inject({ method: 'PATCH', url: `/api/v1/expenses/${expenseX}`, headers: brandOnlyStaff.auth, payload: { notes: 'Updated by brand-only staff' } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as ExpenseDTO).notes).toBe('Updated by brand-only staff');
    });

    it(
      'child/parent consistency: creating an expense under the actor\'s OWN in-scope campaign cannot be laundered onto ' +
        'a different, out-of-scope-brand campaign-influencer by supplying its id in the body (never trust an arbitrary child id just because the parent context was authorized)',
      async () => {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/campaigns/${campaignX}/expenses`,
          headers: brandOnlyStaff.auth,
          payload: { type: 'OTHER', amount: 50, currency: 'KWD', campaignInfluencerId: ciY },
        });
        expect(res.statusCode).toBe(400);

        // Confirm nothing was created and leaked the cross-campaign association.
        const list = (await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignX}/costs`, headers: admin })).json() as { expenses: ExpenseDTO[] };
        expect(list.expenses.some((e) => e.campaignInfluencerId === ciY)).toBe(false);
      },
    );

    it(
      'child/parent consistency holds even WITHIN the actor\'s own in-scope brand: campaignInfluencerId from a sibling ' +
        'campaign (same brand, different campaign) is rejected too — this is a pure parent-id mismatch check, not merely brand scope',
      async () => {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/campaigns/${campaignX}/expenses`,
          headers: brandOnlyStaff.auth,
          payload: { type: 'OTHER', amount: 50, currency: 'KWD', campaignInfluencerId: ciX2 },
        });
        expect(res.statusCode).toBe(400);
      },
    );

    it('the actor CAN create an expense referencing their own campaign\'s own campaign-influencer (positive control)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignX}/expenses`,
        headers: brandOnlyStaff.auth,
        payload: { type: 'OTHER', amount: 50, currency: 'KWD', campaignInfluencerId: ciX },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as ExpenseDTO).campaignInfluencerId).toBe(ciX);
    });
  });

  describe('Country-scope IDOR — campaign-influencer.service.ts::add() per-row influencer country check', () => {
    let campaignForCountryTest: string;

    beforeAll(async () => {
      // countryOnlyStaff has NO brand restriction, so any brand's campaign is
      // in scope for them — isolates the country check on the INFLUENCER row.
      campaignForCountryTest = await app
        .inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandX, name: `${tag} Country Test Camp` } })
        .then(idOf);
    });

    it(
      'a KW-only-scoped actor cannot add an AE creator to an otherwise-in-scope campaign — the campaign being in scope never authorizes an out-of-scope CREATOR',
      async () => {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/campaigns/${campaignForCountryTest}/influencers`,
          headers: countryOnlyStaff.auth,
          payload: { influencerId: influencerAE, dealType: 'FREE' },
        });
        expect(res.statusCode).toBe(404);
      },
    );

    it('the same KW-only-scoped actor CAN add a KW creator to the same campaign (positive control)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignForCountryTest}/influencers`,
        headers: countryOnlyStaff.auth,
        payload: { influencerId: influencerKW, dealType: 'FREE' },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('Combined Brand+Country attack matrix — brand AND country must BOTH match (AND, not OR)', () => {
    // matrixStaff is scoped to Brand X AND country KW. Four cells, each
    // against its own fresh campaign so a successful add() in one cell never
    // conflicts (duplicate-roster) with another cell using the same
    // influencer against a DIFFERENT campaign.
    let campaignBrandInScope: string;
    let campaignBrandOutOfScope: string;

    beforeAll(async () => {
      [campaignBrandInScope, campaignBrandOutOfScope] = await Promise.all([
        app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandX, name: `${tag} Matrix In-Brand` } }).then(idOf),
        app.inject({ method: 'POST', url: '/api/v1/campaigns', headers: admin, payload: { brandId: brandY, name: `${tag} Matrix Out-Brand` } }).then(idOf),
      ]);
    });

    it('brand MATCH + country MATCH -> succeeds (both conditions satisfied)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignBrandInScope}/influencers`,
        headers: matrixStaff.auth,
        payload: { influencerId: influencerKW, dealType: 'FREE' },
      });
      expect(res.statusCode).toBe(201);
    });

    it('brand MATCH + country MISMATCH -> fails (proves the country arm of the AND is actually enforced, not bypassed because the brand matched)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignBrandInScope}/influencers`,
        headers: matrixStaff.auth,
        payload: { influencerId: influencerAE, dealType: 'FREE' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('brand MISMATCH + country MATCH -> fails (proves the brand arm of the AND is actually enforced, not bypassed because the country matched) — this is the OR-vs-AND bug this matrix specifically catches', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignBrandOutOfScope}/influencers`,
        headers: matrixStaff.auth,
        payload: { influencerId: influencerKW, dealType: 'FREE' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('brand MISMATCH + country MISMATCH -> fails (neither condition satisfied)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${campaignBrandOutOfScope}/influencers`,
        headers: matrixStaff.auth,
        payload: { influencerId: influencerAE, dealType: 'FREE' },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
