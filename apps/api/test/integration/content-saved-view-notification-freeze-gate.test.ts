import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  ContentViewerStateDTO,
  CursorPage,
  InfluencerSummaryDTO,
  NotificationDTO,
  Paginated,
  PublishedContentDTO,
  SavedViewDTO,
} from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Security & Authorization Freeze Gate — content.service.ts / saved-view.
 * service.ts / notification.service.ts (spec sections 36-48), covering the
 * four sharper scenarios beyond basic "act on your own record" mutation
 * gating:
 *
 *   1. §37 hard test — content review-state PATCH is always scoped to the
 *      CURRENT actor, never a client-supplied target user id.
 *   2. content.service.ts's feed/detail/update (+ metrics/monitoring/
 *      refresh) apply Brand + Creator Country scope at the DB-query level,
 *      the same posture as campaign.service.ts's buildWhere()/assertInScope.
 *   3. §46 critical test — a shared saved view never grants access: opening
 *      one applies the CURRENT viewer's own live scope, never the scope the
 *      view's creator had when they saved it.
 *   4. §47 — an old notification's deep link never bypasses CURRENT
 *      authorization on its target resource, and its payload carries no
 *      extra resource fields beyond the generic title/body/link.
 */

const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

interface ScopedUser {
  userId: string;
  auth: Record<string, string>;
}

/** A throwaway legacy-STAFF user (no RoleProfile — every operational
 *  capability except the admin-only ones, per capabilities.ts), logged in
 *  immediately. Brand/country scope, if any, is applied by the caller
 *  afterward via the admin brand-access/country-access endpoints. */
async function createStaff(app: FastifyInstance, label: string): Promise<ScopedUser> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `sfg_cn_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({
    data: { email, name: `SFG-CN ${label}`, role: 'STAFF', passwordHash: await hash(password) },
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

describe('Security & Authorization Freeze Gate §37/46/47 — content, saved views, notifications', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let adminId: string;
  const tag = `SFG-CN-${Date.now()}`;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;
  });

  afterAll(async () => {
    await app.close();
    await deleteUser(adminId);
  });

  // -------------------------------------------------------------------
  // 1. Content review-state isolation (§37 hard test)
  // -------------------------------------------------------------------
  describe('item 1 — content view-state PATCH is scoped to the CURRENT actor, never a client-supplied user id', () => {
    let userA: ScopedUser;
    let userB: ScopedUser;
    let contentId: string;

    beforeAll(async () => {
      userA = await createStaff(app, 'viewstate-a');
      userB = await createStaff(app, 'viewstate-b');
      contentId = idOf(
        await app.inject({
          method: 'POST',
          url: '/api/v1/content',
          headers: userA.auth,
          payload: { url: `https://www.youtube.com/watch?v=${tag}VS1` },
        }),
      );
    });

    afterAll(async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.publishedContent.deleteMany({ where: { originalUrl: { contains: tag } } }).catch(() => undefined);
      await prisma.$disconnect();
      await deleteUser(userA.userId);
      await deleteUser(userB.userId);
    });

    it("User A's PATCH cannot affect User B's review state, even when A's payload names B's id under every plausible field", async () => {
      // contentViewStateSchema only ever recognizes seen/reviewed/reviewLater
      // — there is no userId/targetUserId field in its contract at all, and
      // updateViewState() always writes to requireActor(ctx).id. Extra keys
      // are dropped by schema validation before the service ever sees them;
      // this proves that even a client that tries to smuggle a target id
      // through has zero effect.
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/content/${contentId}/view-state`,
        headers: userA.auth,
        payload: { seen: true, userId: userB.userId, targetUserId: userB.userId, actorId: userB.userId } as never,
      });
      expect(res.statusCode).toBe(200);
      const aWrite = res.json() as ContentViewerStateDTO;
      expect(aWrite.firstSeenAt).not.toBeNull(); // A's own state WAS written

      // B is completely untouched, despite A's payload naming B's id.
      const bDetail = (await app.inject({ method: 'GET', url: `/api/v1/content/${contentId}`, headers: userB.auth })).json() as PublishedContentDTO;
      expect(bDetail.viewerState).toBeNull();

      // A's own state persists under A.
      const aDetail = (await app.inject({ method: 'GET', url: `/api/v1/content/${contentId}`, headers: userA.auth })).json() as PublishedContentDTO;
      expect(aDetail.viewerState?.firstSeenAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // 2. Content Brand + Creator Country scope (feed/detail/update + the
  //    same direct-ID accessors: metrics, monitoring, manual metrics,
  //    refresh)
  // -------------------------------------------------------------------
  describe('item 2 — content.service.ts direct-ID accessors honor Brand + Creator Country scope', () => {
    let brandA: string;
    let brandB: string;
    let brandStaff: ScopedUser; // scoped to brandA only
    let contentA: string; // brandA
    let contentB: string; // brandB

    let kwInfluencer: string;
    let saInfluencer: string;
    let countryStaff: ScopedUser; // scoped to KW only, unrestricted by brand
    let contentKW: string; // influencerId = kwInfluencer, no brand
    let contentSA: string; // influencerId = saInfluencer, no brand
    let contentUnassigned: string; // no brand, no influencer

    beforeAll(async () => {
      brandA = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `${tag} Brand A` } }));
      brandB = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `${tag} Brand B` } }));
      brandStaff = await createStaff(app, 'brand-scope');
      await setBrandAccess(app, admin, brandStaff.userId, [brandA]);

      contentA = idOf(
        await app.inject({ method: 'POST', url: '/api/v1/content', headers: admin, payload: { url: `https://www.youtube.com/watch?v=${tag}CA1`, brandId: brandA } }),
      );
      contentB = idOf(
        await app.inject({ method: 'POST', url: '/api/v1/content', headers: admin, payload: { url: `https://www.youtube.com/watch?v=${tag}CB1`, brandId: brandB } }),
      );

      kwInfluencer = idOf(
        await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `${tag} KW Creator`, countryCode: 'KW' } }),
      );
      saInfluencer = idOf(
        await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `${tag} SA Creator`, countryCode: 'SA' } }),
      );
      countryStaff = await createStaff(app, 'country-scope');
      await setCountryAccess(app, admin, countryStaff.userId, ['KW']);

      contentKW = idOf(
        await app.inject({ method: 'POST', url: '/api/v1/content', headers: admin, payload: { url: `https://www.youtube.com/watch?v=${tag}CK1`, influencerId: kwInfluencer } }),
      );
      contentSA = idOf(
        await app.inject({ method: 'POST', url: '/api/v1/content', headers: admin, payload: { url: `https://www.youtube.com/watch?v=${tag}CS1`, influencerId: saInfluencer } }),
      );
      contentUnassigned = idOf(
        await app.inject({ method: 'POST', url: '/api/v1/content', headers: admin, payload: { url: `https://www.youtube.com/watch?v=${tag}CU1` } }),
      );
    });

    afterAll(async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.publishedContent.deleteMany({ where: { originalUrl: { contains: tag } } }).catch(() => undefined);
      await prisma.brand.deleteMany({ where: { id: { in: [brandA, brandB] } } }).catch(() => undefined);
      await prisma.influencer.deleteMany({ where: { id: { in: [kwInfluencer, saInfluencer] } } }).catch(() => undefined);
      await prisma.$disconnect();
      await deleteUser(brandStaff.userId);
      await deleteUser(countryStaff.userId);
    });

    it('Brand scope: the feed includes only the scoped staff\'s own brand, even with no explicit brandId filter', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/content/feed?q=${tag}&limit=50`, headers: brandStaff.auth });
      expect(res.statusCode).toBe(200);
      const ids = (res.json() as CursorPage<PublishedContentDTO>).data.map((c) => c.id);
      expect(ids).toContain(contentA);
      expect(ids).not.toContain(contentB);
    });

    it('Brand scope: an out-of-scope content id 404s on every direct-ID accessor — detail, metrics, monitoring, manual metrics, refresh, update', async () => {
      expect((await app.inject({ method: 'GET', url: `/api/v1/content/${contentB}`, headers: brandStaff.auth })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/api/v1/content/${contentB}/metrics`, headers: brandStaff.auth })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/api/v1/content/${contentB}/monitoring`, headers: brandStaff.auth })).statusCode).toBe(404);
      expect(
        (await app.inject({ method: 'POST', url: `/api/v1/content/${contentB}/metrics`, headers: brandStaff.auth, payload: { views: 10 } })).statusCode,
      ).toBe(404);
      expect((await app.inject({ method: 'POST', url: `/api/v1/content/${contentB}/refresh`, headers: brandStaff.auth })).statusCode).toBe(404);
      expect(
        (await app.inject({ method: 'PATCH', url: `/api/v1/content/${contentB}`, headers: brandStaff.auth, payload: { caption: 'nope' } })).statusCode,
      ).toBe(404);
    });

    it('Brand scope: the same staff user CAN reach their own in-scope content by id', async () => {
      expect((await app.inject({ method: 'GET', url: `/api/v1/content/${contentA}`, headers: brandStaff.auth })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `/api/v1/content/${contentA}/metrics`, headers: brandStaff.auth })).statusCode).toBe(200);
    });

    it('Creator Country scope: the feed includes only the KW-scoped staff\'s own country, and unassigned content stays visible', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/content/feed?q=${tag}&limit=50`, headers: countryStaff.auth });
      expect(res.statusCode).toBe(200);
      const ids = (res.json() as CursorPage<PublishedContentDTO>).data.map((c) => c.id);
      expect(ids).toContain(contentKW);
      expect(ids).not.toContain(contentSA);
      expect(ids).toContain(contentUnassigned); // no influencer => no creator-country dimension to restrict
    });

    it('Creator Country scope: a KW-scoped staff user cannot reach the SA creator\'s content directly by id, but can reach the KW one', async () => {
      expect((await app.inject({ method: 'GET', url: `/api/v1/content/${contentSA}`, headers: countryStaff.auth })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/api/v1/content/${contentKW}`, headers: countryStaff.auth })).statusCode).toBe(200);
    });
  });

  // -------------------------------------------------------------------
  // 3. Saved Views (§46) — a shared saved view never grants access
  // -------------------------------------------------------------------
  describe('item 3 — a shared saved view never grants access beyond the CURRENT viewer\'s own scope', () => {
    let kwInfluencer2: string;
    let saInfluencer2: string;
    let countryStaff2: ScopedUser; // scoped to KW only
    let sharedViewId: string;

    beforeAll(async () => {
      kwInfluencer2 = idOf(
        await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `${tag} SV KW Creator`, countryCode: 'KW' } }),
      );
      saInfluencer2 = idOf(
        await app.inject({ method: 'POST', url: '/api/v1/influencers', headers: admin, payload: { displayName: `${tag} SV SA Creator`, countryCode: 'SA' } }),
      );
      countryStaff2 = await createStaff(app, 'saved-view-scope');
      await setCountryAccess(app, admin, countryStaff2.userId, ['KW']);
    });

    afterAll(async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.savedView.deleteMany({ where: { id: sharedViewId } }).catch(() => undefined);
      await prisma.influencer.deleteMany({ where: { id: { in: [kwInfluencer2, saInfluencer2] } } }).catch(() => undefined);
      await prisma.$disconnect();
      await deleteUser(countryStaff2.userId);
    });

    it("the SAME shared saved view returns different results depending on who currently opens it — never the creator's own scope", async () => {
      // An unscoped admin saves a broad (empty-filter) shared view.
      const shared = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/saved-views',
          headers: admin,
          payload: { scope: `influencers-sv-${tag}`, name: 'All creators', filters: {}, isShared: true },
        })
      ).json() as SavedViewDTO;
      sharedViewId = shared.id;

      // Positive control: the admin's OWN view of the (unrestricted) target
      // list includes both creators.
      const asAdmin = (
        await app.inject({ method: 'GET', url: `/api/v1/influencers?pageSize=100`, headers: admin })
      ).json() as Paginated<InfluencerSummaryDTO>;
      const adminIds = asAdmin.data.map((r) => r.id);
      expect(adminIds).toContain(kwInfluencer2);
      expect(adminIds).toContain(saInfluencer2);

      // The KW-scoped staff user sees the shared view listed (not own)...
      const listed = (
        await app.inject({ method: 'GET', url: `/api/v1/saved-views?scope=influencers-sv-${tag}`, headers: countryStaff2.auth })
      ).json() as SavedViewDTO[];
      const view = listed.find((v) => v.id === shared.id);
      expect(view).toBeTruthy();
      expect(view!.isOwn).toBe(false);

      // ...and "opening" it (applying its stored filters as the CURRENT
      // caller) against the SAME target list endpoint returns ONLY the
      // KW-scoped staff's own authorized subset — the saved filter carries
      // no scope of its own, and the view's admin creator's broader access
      // never leaks through it.
      const params = new URLSearchParams(view!.filters as Record<string, string>);
      params.set('pageSize', '100');
      const asStaff = (
        await app.inject({ method: 'GET', url: `/api/v1/influencers?${params.toString()}`, headers: countryStaff2.auth })
      ).json() as Paginated<InfluencerSummaryDTO>;
      const staffIds = asStaff.data.map((r) => r.id);
      expect(staffIds).toContain(kwInfluencer2);
      expect(staffIds).not.toContain(saInfluencer2);
    });
  });

  // -------------------------------------------------------------------
  // 4. Notifications (§47) — deep links never bypass current scope, and
  //    payloads carry no extra PII
  // -------------------------------------------------------------------
  describe('item 4 — a notification deep link never bypasses CURRENT authorization, and its payload carries no extra PII', () => {
    let brandC: string;
    let brandD: string; // kept in scope throughout, so revoking C still leaves the actor genuinely "scoped" (not accidentally unscoped by a 0-row access set)
    let notifStaff: ScopedUser;
    let notifContentId: string;

    beforeAll(async () => {
      brandC = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `${tag} Brand C` } }));
      brandD = idOf(await app.inject({ method: 'POST', url: '/api/v1/brands', headers: admin, payload: { name: `${tag} Brand D` } }));
      notifStaff = await createStaff(app, 'notif-scope');
      await setBrandAccess(app, admin, notifStaff.userId, [brandC, brandD]);

      notifContentId = idOf(
        await app.inject({
          method: 'POST',
          url: '/api/v1/content',
          headers: notifStaff.auth,
          payload: { url: `https://www.youtube.com/watch?v=${tag}ND1`, brandId: brandC },
        }),
      );
    });

    afterAll(async () => {
      const { PrismaClient } = await import('@influenceos/database');
      const prisma = new PrismaClient();
      await prisma.publishedContent.deleteMany({ where: { originalUrl: { contains: tag } } }).catch(() => undefined);
      await prisma.brand.deleteMany({ where: { id: { in: [brandC, brandD] } } }).catch(() => undefined);
      await prisma.$disconnect();
      await deleteUser(notifStaff.userId);
    });

    it('the NEW_CONTENT notification payload is generic title/body/link only — no extra resource fields (e.g. address/phone) leak through it', async () => {
      const list = (
        await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: notifStaff.auth })
      ).json() as CursorPage<NotificationDTO>;
      const notif = list.data.find((n) => n.targetUrl === `/content/${notifContentId}`);
      expect(notif).toBeTruthy();
      expect(Object.keys(notif!).sort()).toEqual(['body', 'category', 'createdAt', 'id', 'isRead', 'targetUrl', 'title'].sort());
    });

    it("revoking the actor's access to the notification's brand afterward hides that team-wide notification and its deep link 404s — never a 'trusted because it's from a notification' bypass", async () => {
      // Confirm the deep link's target works BEFORE revocation.
      expect((await app.inject({ method: 'GET', url: `/api/v1/content/${notifContentId}`, headers: notifStaff.auth })).statusCode).toBe(200);

      // Revoke Brand C specifically (Brand D stays, so the actor remains
      // genuinely brand-scoped rather than reverting to unscoped).
      await setBrandAccess(app, admin, notifStaff.userId, [brandD]);

      // NEW_CONTENT is a team-wide notification. Since P2.6 team-wide
      // notifications follow the reader's CURRENT brand scope (their text
      // can name brands, creators and campaigns), so it is no longer listed
      // — and it no longer counts as unread.
      const after = (
        await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: notifStaff.auth })
      ).json() as CursorPage<NotificationDTO>;
      expect(after.data.some((n) => n.targetUrl === `/content/${notifContentId}`)).toBe(false);

      // ...and following the old deep link enforces CURRENT scope on the
      // target resource and denies it, exactly like any other direct-ID
      // reach — the notification's prior existence grants nothing.
      expect((await app.inject({ method: 'GET', url: `/api/v1/content/${notifContentId}`, headers: notifStaff.auth })).statusCode).toBe(404);
    });
  });
});
