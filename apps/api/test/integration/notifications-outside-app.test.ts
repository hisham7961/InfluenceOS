import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CursorPage, DigestDTO, NotificationDTO, NotificationSettingsDTO } from '@influenceos/contracts';
import { addBusinessDays, businessDateKey, startOfBusinessDay } from '@influenceos/shared';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P2.6 — alerts that reach people outside the app.
 *
 * - Team-wide notifications have a read state per person and follow the
 *   reader's brand and country scope.
 * - Reminders (domain rules, run by the worker) name the creator and what is
 *   owed, go to the campaign's and the creator's owners, group several on one
 *   campaign, repeat while overdue, and never double-send.
 * - Email: the kinds a person picked arrive as they happen (in their
 *   language, only for what they can see, recorded and retried), and the
 *   morning summary goes out once, only when something needs attention.
 */
type Session = { userId: string; auth: Record<string, string> };

async function createUser(app: FastifyInstance, label: string, data: Record<string, unknown> = {}): Promise<Session> {
  const { PrismaClient } = await import('@influenceos/database');
  const { hash } = await import('@node-rs/argon2');
  const prisma = new PrismaClient();
  const email = `p26_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const user = await prisma.user.create({
    data: { email, name: `P26 ${label}`, role: 'STAFF', passwordHash: await hash(password), ...data },
  });
  await prisma.$disconnect();
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const token = (res.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { userId: user.id, auth: { authorization: `Bearer ${token}` } };
}

describe('P2.6 — per-person read state, scoped team alerts, reminders, email', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let admin: Record<string, string>;
  let adminId: string;
  const tag = `P26${Date.now()}`;
  const day = 864e5;
  const users: Session[] = [];
  let brandX: string;
  let brandY: string;
  let brandEmpty: string;

  const list = async (s: Session, unreadOnly = false) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/v1/notifications?limit=50${unreadOnly ? '&unreadOnly=true' : ''}`,
        headers: s.auth,
      })
    ).json() as CursorPage<NotificationDTO>;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    admin = a.auth;
    adminId = a.userId;
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    brandX = (await prisma.brand.create({ data: { name: `${tag} X`, slug: `${tag.toLowerCase()}-x` } })).id;
    brandY = (await prisma.brand.create({ data: { name: `${tag} Y`, slug: `${tag.toLowerCase()}-y` } })).id;
    brandEmpty = (await prisma.brand.create({ data: { name: `${tag} Empty`, slug: `${tag.toLowerCase()}-e` } })).id;
  });

  afterAll(async () => {
    const { __setTestEmailTransport } = await import('@influenceos/domain');
    __setTestEmailTransport(null);
    const brands = [brandX, brandY, brandEmpty];
    await prisma.notification.deleteMany({ where: { OR: [{ brandId: { in: brands } }, { title: { contains: tag } }] } });
    await prisma.campaign.deleteMany({ where: { brandId: { in: brands } } });
    await prisma.influencer.deleteMany({ where: { displayName: { startsWith: tag } } });
    await prisma.brand.deleteMany({ where: { id: { in: brands } } });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u.userId);
    await deleteUser(adminId);
  });

  describe('read state and scope', () => {
    let a: Session;
    let b: Session;
    let scopedY: Session;
    let scopedAE: Session;
    let broadcastX: string;

    beforeAll(async () => {
      a = await createUser(app, 'a');
      b = await createUser(app, 'b');
      scopedY = await createUser(app, 'y');
      scopedAE = await createUser(app, 'ae');
      users.push(a, b, scopedY, scopedAE);
      await prisma.userBrandAccess.create({ data: { userId: scopedY.userId, brandId: brandY } });
      await prisma.userCountryAccess.create({ data: { userId: scopedAE.userId, countryCode: 'AE' } });
      const kw = await prisma.influencer.create({ data: { displayName: `${tag} KW creator`, countryCode: 'KW' } });
      const ae = await prisma.influencer.create({ data: { displayName: `${tag} AE creator`, countryCode: 'AE' } });

      broadcastX = (
        await prisma.notification.create({ data: { category: 'GENERAL', title: `${tag} team X`, brandId: brandX } })
      ).id;
      await prisma.notification.create({ data: { category: 'GENERAL', title: `${tag} team Y`, brandId: brandY } });
      await prisma.notification.create({ data: { category: 'GENERAL', title: `${tag} team all` } });
      await prisma.notification.create({ data: { category: 'GENERAL', title: `${tag} team KW`, influencerId: kw.id } });
      await prisma.notification.create({ data: { category: 'GENERAL', title: `${tag} team AE`, influencerId: ae.id } });
      await prisma.notification.create({ data: { category: 'GENERAL', title: `${tag} for b`, userId: b.userId } });
    });

    it("one person's 'mark all read' never clears a team-wide notification for anyone else", async () => {
      const mine = (await list(a)).data.filter((n) => n.title.startsWith(tag));
      expect(mine.map((n) => n.title).sort()).toEqual([`${tag} team AE`, `${tag} team KW`, `${tag} team X`, `${tag} team Y`, `${tag} team all`].sort());
      expect(mine.every((n) => !n.isRead)).toBe(true);

      const res = await app.inject({ method: 'POST', url: '/api/v1/notifications/read', headers: a.auth, payload: { all: true } });
      expect(res.statusCode).toBe(200);

      expect((await list(a, true)).data.some((n) => n.title.startsWith(tag))).toBe(false);
      expect((await list(a)).data.find((n) => n.id === broadcastX)?.isRead).toBe(true);
      // b still sees them unread, and its own notification too.
      const bUnread = (await list(b, true)).data.filter((n) => n.title.startsWith(tag)).map((n) => n.title);
      expect(bUnread).toContain(`${tag} team X`);
      expect(bUnread).toContain(`${tag} for b`);
      const bCount = (await app.inject({ method: 'GET', url: '/api/v1/notifications/unread-count', headers: b.auth })).json() as { count: number };
      expect(bCount.count).toBeGreaterThanOrEqual(6);

      // Marking by id: b reads one team-wide notification; a's state is unchanged.
      await app.inject({ method: 'POST', url: '/api/v1/notifications/read', headers: b.auth, payload: { ids: [broadcastX] } });
      expect((await list(b)).data.find((n) => n.id === broadcastX)?.isRead).toBe(true);
      expect((await list(b, true)).data.some((n) => n.title === `${tag} team Y`)).toBe(true);
      const row = await prisma.notification.findUnique({ where: { id: broadcastX } });
      expect(row?.isRead).toBe(false); // the shared row itself never flips
    });

    it("someone else's personal notification can't be marked read", async () => {
      const bOwn = (await list(b)).data.find((n) => n.title === `${tag} for b`)!;
      await app.inject({ method: 'POST', url: '/api/v1/notifications/read', headers: a.auth, payload: { ids: [bOwn.id] } });
      expect((await list(b)).data.find((n) => n.id === bOwn.id)?.isRead).toBe(false);
    });

    it('team-wide notifications follow brand and country scope', async () => {
      const y = (await list(scopedY)).data.filter((n) => n.title.startsWith(tag)).map((n) => n.title);
      expect(y).toContain(`${tag} team Y`);
      expect(y).toContain(`${tag} team all`);
      expect(y).not.toContain(`${tag} team X`);

      const ae = (await list(scopedAE)).data.filter((n) => n.title.startsWith(tag)).map((n) => n.title);
      expect(ae).toContain(`${tag} team AE`);
      expect(ae).toContain(`${tag} team X`);
      expect(ae).not.toContain(`${tag} team KW`);

      // Marking all read only touches what the reader can see.
      await app.inject({ method: 'POST', url: '/api/v1/notifications/read', headers: scopedY.auth, payload: { all: true } });
      const reads = await prisma.notificationRead.count({ where: { userId: scopedY.userId, notification: { brandId: brandX } } });
      expect(reads).toBe(0);
    });
  });

  describe('reminders', () => {
    let owner: Session;
    let creatorOwner: Session;
    let campaignId: string;
    let ciId: string;
    let d1: string;
    let quietCampaignId: string;

    beforeAll(async () => {
      owner = await createUser(app, 'owner');
      creatorOwner = await createUser(app, 'crowner', { locale: 'ar' });
      users.push(owner, creatorOwner);
      const inf = await prisma.influencer.create({
        data: { displayName: `${tag} Maya`, countryCode: 'KW', ownerId: creatorOwner.userId },
      });
      const campaign = await prisma.campaign.create({
        data: {
          brandId: brandX,
          name: `${tag} Winter`,
          slug: `${tag.toLowerCase()}-winter`,
          ownerId: owner.userId,
          status: 'ACTIVE',
          endDate: new Date(Date.now() + 2 * day),
        },
      });
      campaignId = campaign.id;
      ciId = (await prisma.campaignInfluencer.create({ data: { campaignId, influencerId: inf.id } })).id;
      d1 = (
        await prisma.deliverable.create({
          data: { campaignInfluencerId: ciId, platform: 'INSTAGRAM', type: 'REEL', status: 'IN_REVIEW', dueDate: new Date(Date.now() - 5 * day) },
        })
      ).id;

      // A campaign nobody owns: its reminder goes to the whole team (brand Y).
      const loner = await prisma.influencer.create({ data: { displayName: `${tag} Sara`, countryCode: 'KW' } });
      quietCampaignId = (
        await prisma.campaign.create({ data: { brandId: brandY, name: `${tag} Quiet`, slug: `${tag.toLowerCase()}-quiet` } })
      ).id;
      const ci2 = (await prisma.campaignInfluencer.create({ data: { campaignId: quietCampaignId, influencerId: loner.id } })).id;
      const tomorrow = new Date(startOfBusinessDay(addBusinessDays(businessDateKey(new Date()), 1)).getTime() + 12 * 3600_000);
      await prisma.deliverable.create({
        data: { campaignInfluencerId: ci2, platform: 'TIKTOK', type: 'VIDEO', status: 'APPROVED', dueDate: tomorrow },
      });
    });

    it('names the creator and deliverable, reaches both owners, links to the deliverables tab, and never double-sends', async () => {
      const { runReminders, systemContext } = await import('@influenceos/domain');
      await runReminders(systemContext(), new Date());

      const overdue = await prisma.notification.findMany({ where: { category: 'DELIVERABLE_OVERDUE', campaignId } });
      expect(overdue.map((n) => n.userId).sort()).toEqual([owner.userId, creatorOwner.userId].sort());
      for (const n of overdue) {
        expect(n.title).toBe('Deliverable overdue');
        expect(n.body).toBe(`${tag} Maya: Reel for ${tag} Winter is past its due date.`);
        expect(n.targetUrl).toBe(`/campaigns/${campaignId}?tab=deliverables`);
      }
      // Approved-but-not-posted work counts; nobody owns it → the team, scoped to its brand.
      const soon = await prisma.notification.findMany({ where: { category: 'DELIVERABLE_DUE_SOON', campaignId: quietCampaignId } });
      expect(soon).toHaveLength(1);
      expect(soon[0]!.userId).toBeNull();
      expect(soon[0]!.brandId).toBe(brandY);
      expect(soon[0]!.body).toBe(`${tag} Sara: Video for ${tag} Quiet is due tomorrow.`);

      const ending = await prisma.notification.findMany({ where: { category: 'CAMPAIGN_ENDING', campaignId } });
      expect(ending).toHaveLength(1);
      expect(ending[0]!.dedupeKey).toMatch(new RegExp(`^campaign-ending:${campaignId}:`));

      await runReminders(systemContext(), new Date());
      expect(await prisma.notification.count({ where: { category: 'DELIVERABLE_OVERDUE', campaignId } })).toBe(2);
      expect(await prisma.notification.count({ where: { category: 'DELIVERABLE_DUE_SOON', campaignId: quietCampaignId } })).toBe(1);
      expect(await prisma.notification.count({ where: { category: 'CAMPAIGN_ENDING', campaignId } })).toBe(1);
    });

    it('repeats while overdue, and groups several on one campaign into one line per person', async () => {
      const { runReminders, systemContext, OVERDUE_REPEAT_DAYS } = await import('@influenceos/domain');
      await prisma.deliverable.create({
        data: { campaignInfluencerId: ciId, platform: 'INSTAGRAM', type: 'STORY', status: 'PLANNED', dueDate: new Date(Date.now() - 2 * day) },
      });
      await prisma.deliverable.update({
        where: { id: d1 },
        data: { overdueRemindedAt: new Date(Date.now() - (OVERDUE_REPEAT_DAYS + 1) * day) },
      });
      await runReminders(systemContext(), new Date());
      const grouped = await prisma.notification.findMany({
        where: { category: 'DELIVERABLE_OVERDUE', campaignId, title: 'Deliverables overdue' },
      });
      expect(grouped.map((n) => n.userId).sort()).toEqual([owner.userId, creatorOwner.userId].sort());
      expect(grouped[0]!.body).toBe(`2 deliverables in ${tag} Winter are past their due date.`);
    });

    it("the owner's summary lists their overdue work; a summary goes out once, in the reader's language", async () => {
      const preview = (
        await app.inject({ method: 'GET', url: '/api/v1/notifications/digest-preview', headers: owner.auth })
      ).json() as DigestDTO;
      expect(preview.onlyMine).toBe(true);
      expect(preview.overdue.total).toBe(2);
      expect(preview.overdue.items.map((i) => i.id)).toContain(d1);
      expect(preview.overdue.items[0]!.link).toBe(`/campaigns/${campaignId}?tab=deliverables`);
      expect(preview.isEmpty).toBe(false);

      const { sendDueDigests, __resetDigestRetries } = await import('@influenceos/domain');
      __resetDigestRetries();
      const sent: { to: string; subject: string; text: string; html?: string }[] = [];
      const mailer = async (m: { to: string; subject: string; text: string; html?: string }) => {
        sent.push(m);
      };
      const nineAm = new Date(startOfBusinessDay(businessDateKey(new Date())).getTime() + 9 * 3600_000);
      const emptyReader = await createUser(app, 'empty');
      users.push(emptyReader);
      await prisma.userBrandAccess.create({ data: { userId: emptyReader.userId, brandId: brandEmpty } });
      const off = await createUser(app, 'off', { digestFrequency: 'OFF' });
      users.push(off);

      const ids = [owner.userId, creatorOwner.userId, emptyReader.userId, off.userId];
      const opts = { mailer, from: 'InfluenceOS <alerts@example.test>', appUrl: 'https://app.example.test', now: nineAm, userIds: ids };
      const first = await sendDueDigests(prisma, opts);
      expect(first.sent).toBe(2);
      expect(first.empty).toBe(1);
      const ownerMail = sent.find((m) => m.to.includes('p26_owner_'))!;
      expect(ownerMail.subject).toMatch(/^Your InfluenceOS summary — /);
      expect(ownerMail.text).toContain(`${tag} Maya`);
      expect(ownerMail.text).toContain(`https://app.example.test/campaigns/${campaignId}?tab=deliverables`);
      const arMail = sent.find((m) => m.to.includes('p26_crowner_'))!;
      expect(arMail.subject).toMatch(/^ملخّصك في InfluenceOS — /);
      expect(arMail.html).toContain('dir="rtl"');

      const again = await sendDueDigests(prisma, opts);
      expect(again.sent + again.empty).toBe(0);

      // Before 8:00 Kuwait nothing is due.
      const { digestPeriodStart } = await import('@influenceos/domain');
      const sevenAm = new Date(startOfBusinessDay(businessDateKey(new Date())).getTime() + 7 * 3600_000);
      expect(digestPeriodStart('DAILY', sevenAm)).toBeNull();
    });
  });

  describe('email as it happens', () => {
    let reader: Session;
    let quiet: Session;
    let otherBrand: Session;

    beforeAll(async () => {
      const { dispatchNotificationEmails } = await import('@influenceos/domain');
      // Everything created before this point counts as handled.
      await dispatchNotificationEmails(prisma, { mailer: null, from: '', appUrl: '' });
      reader = await createUser(app, 'reader', { locale: 'ar' });
      quiet = await createUser(app, 'quiet', { emailCategories: [] });
      otherBrand = await createUser(app, 'other');
      users.push(reader, quiet, otherBrand);
      await prisma.userBrandAccess.create({ data: { userId: otherBrand.userId, brandId: brandY } });
    });

    it("sends the kinds each person chose, in their language, only for what they can see — once", async () => {
      const { dispatchNotificationEmails } = await import('@influenceos/domain');
      const mention = await prisma.notification.create({
        data: { category: 'MENTION', title: `${tag} Lina mentioned you`, userId: reader.userId, targetUrl: '/team' },
      });
      const removed = await prisma.notification.create({
        data: { category: 'CONTENT_REMOVED', title: `${tag} post removed`, brandId: brandX, targetUrl: '/content' },
      });
      const sent: { to: string; subject: string; text: string }[] = [];
      const res = await dispatchNotificationEmails(prisma, {
        mailer: async (m) => {
          sent.push(m);
        },
        from: 'InfluenceOS <alerts@example.test>',
        appUrl: 'https://app.example.test',
      });
      expect(res.failed).toBe(0);
      const toReader = sent.filter((m) => m.to.includes('p26_reader_'));
      expect(toReader.map((m) => m.subject).sort()).toEqual([`${tag} post removed`, `⁨${tag} Lina⁩ أشار إليك`].sort());
      expect(sent.some((m) => m.to.includes('p26_quiet_'))).toBe(false); // chose nothing
      expect(sent.some((m) => m.to.includes('p26_other_') && m.subject.includes('post removed'))).toBe(false); // other brand
      expect(toReader.find((m) => m.subject.includes('أشار'))!.text).toContain('https://app.example.test/team');

      const deliveries = await prisma.notificationDelivery.findMany({ where: { notificationId: { in: [mention.id, removed.id] }, channel: 'EMAIL' } });
      expect(deliveries.filter((d) => d.target === reader.userId).every((d) => d.status === 'SENT')).toBe(true);

      const before = sent.length;
      await dispatchNotificationEmails(prisma, { mailer: async (m) => void sent.push(m), from: 'x@example.test', appUrl: 'https://app.example.test' });
      expect(sent.filter((m) => m.to.includes('p26_reader_')).length).toBe(toReader.length);
      expect(sent.length).toBeGreaterThanOrEqual(before);
    });

    it('records a failed send and retries it later', async () => {
      const { dispatchNotificationEmails } = await import('@influenceos/domain');
      const n = await prisma.notification.create({
        data: { category: 'MENTION', title: `${tag} retry me`, userId: reader.userId },
      });
      await dispatchNotificationEmails(prisma, {
        mailer: async (m) => {
          if (m.subject.includes('retry me')) throw new Error('451 try again later');
        },
        from: 'x@example.test',
        appUrl: 'https://app.example.test',
      });
      const failed = await prisma.notificationDelivery.findFirst({ where: { notificationId: n.id, channel: 'EMAIL' } });
      expect(failed).toMatchObject({ status: 'FAILED', attempts: 1, target: reader.userId });
      expect(failed!.error).toContain('451');

      const later = new Date(Date.now() + 15 * 60_000);
      const got: string[] = [];
      await dispatchNotificationEmails(prisma, { mailer: async (m) => void got.push(m.subject), from: 'x@example.test', appUrl: 'https://app.example.test', now: later });
      expect(got.some((s) => s.includes('retry me'))).toBe(true);
      const retried = await prisma.notificationDelivery.findUnique({ where: { id: failed!.id } });
      expect(retried).toMatchObject({ status: 'SENT', attempts: 2, error: null });
    });
  });

  describe('settings API', () => {
    it('reads and changes your email settings; rejects unknown kinds', async () => {
      const me = await createUser(app, 'settings');
      users.push(me);
      const s = (await app.inject({ method: 'GET', url: '/api/v1/notifications/settings', headers: me.auth })).json() as NotificationSettingsDTO;
      expect(s.digestFrequency).toBe('DAILY');
      expect(s.emailCategories.sort()).toEqual(['CONTENT_REMOVED', 'MENTION']);
      expect(s.email).toContain('p26_settings_');

      const patched = await app.inject({
        method: 'PATCH',
        url: '/api/v1/notifications/settings',
        headers: me.auth,
        payload: { digestFrequency: 'WEEKLY', emailCategories: ['DELIVERABLE_OVERDUE', 'MENTION', 'MENTION'] },
      });
      expect(patched.statusCode).toBe(200);
      expect((patched.json() as NotificationSettingsDTO).digestFrequency).toBe('WEEKLY');
      expect((patched.json() as NotificationSettingsDTO).emailCategories.sort()).toEqual(['DELIVERABLE_OVERDUE', 'MENTION']);

      const bad = await app.inject({ method: 'PATCH', url: '/api/v1/notifications/settings', headers: me.auth, payload: { emailCategories: ['NOPE'] } });
      expect(bad.statusCode).toBe(422);
      const empty = await app.inject({ method: 'PATCH', url: '/api/v1/notifications/settings', headers: me.auth, payload: {} });
      expect(empty.statusCode).toBe(422);
    });

    it('a test email says plainly when email is not set up, sends when it is, and at most once a minute', async () => {
      const { __setTestEmailTransport } = await import('@influenceos/domain');
      const me = await createUser(app, 'tester', { locale: 'ar' });
      users.push(me);
      __setTestEmailTransport(null);
      const prev = process.env.SMTP_URL;
      delete process.env.SMTP_URL;
      const off = await app.inject({ method: 'POST', url: '/api/v1/notifications/test-email', headers: me.auth });
      expect(off.statusCode).toBe(409);
      expect((off.json() as { error: { message: string } }).error.message).toBe('Email is not set up on this server yet.');

      const sent: { to: string; subject: string }[] = [];
      __setTestEmailTransport({
        config: { smtp: { host: 'x', port: 465, secure: true, insecure: false }, from: 'InfluenceOS <a@example.test>', appUrl: 'https://app.example.test' },
        mailer: async (m) => void sent.push(m),
      });
      const settings = (await app.inject({ method: 'GET', url: '/api/v1/notifications/settings', headers: me.auth })).json() as NotificationSettingsDTO;
      expect(settings.emailConfigured).toBe(true);
      const ok = await app.inject({ method: 'POST', url: '/api/v1/notifications/test-email', headers: me.auth });
      expect(ok.statusCode).toBe(200);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.subject).toBe('رسالة تجريبية من InfluenceOS');
      const tooSoon = await app.inject({ method: 'POST', url: '/api/v1/notifications/test-email', headers: me.auth });
      expect(tooSoon.statusCode).toBe(409);
      __setTestEmailTransport(null);
      if (prev !== undefined) process.env.SMTP_URL = prev;
    });
  });
});
