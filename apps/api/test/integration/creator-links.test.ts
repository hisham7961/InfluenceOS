import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@influenceos/api-client';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P3.3 — creator task links: a creator's part of one campaign without an
 * account. They see the brief, their own deliverables and the approved
 * script (never money, internal notes or another creator's work), send a
 * draft and the live post link, and see the team's decision; the team sees
 * the draft as sent by the creator. Written against the typed API client.
 */
describe('P3.3 — creator task links', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let admin: Awaited<ReturnType<typeof loginFresh>>;
  let api: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const tag = `P33C${Date.now()}`;
  let brandId: string;
  let otherBrandId: string;
  let campaignId: string;
  let sara: string;
  let maya: string;
  let saraRow: string;
  let mayaRow: string;
  let reel: string;
  let story: string;
  let mayaTask: string;
  const PERSON =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

  async function staff(
    label: string,
    roleProfile: 'INFLUENCER_MANAGER' | 'GENERAL_MANAGER' | 'OPERATIONS_MANAGER',
    brands?: string[],
  ) {
    const { hash } = await import('@node-rs/argon2');
    const email = `${tag.toLowerCase()}_${label}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: {
        email,
        name: `${tag} ${label}`,
        role: 'STAFF',
        roleProfile,
        passwordHash: await hash(password),
      },
    });
    users.push(user.id);
    for (const b of brands ?? [])
      await prisma.userBrandAccess.create({ data: { userId: user.id, brandId: b } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const { accessToken } = (res.json() as { tokens: { accessToken: string } }).tokens;
    return clientFor(app, { authorization: `Bearer ${accessToken}` });
  }

  const status = async (p: Promise<unknown>) => {
    try {
      await p;
      return 200;
    } catch (e) {
      if (e instanceof ApiError) return e.status;
      throw e;
    }
  };
  const tokenOf = (path: string) => path.replace('/share/c/', '');

  beforeAll(async () => {
    app = await makeApp();
    admin = await loginFresh(app);
    users.push(admin.userId);
    api = await clientFor(app, admin.auth);
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    brandId = (
      await prisma.brand.create({
        data: { name: `${tag} Glow`, slug: `${tag.toLowerCase()}-glow` },
      })
    ).id;
    otherBrandId = (
      await prisma.brand.create({
        data: { name: `${tag} Other`, slug: `${tag.toLowerCase()}-other` },
      })
    ).id;
    sara = (
      await prisma.influencer.create({ data: { displayName: `${tag} Sara`, countryCode: 'KW' } })
    ).id;
    maya = (
      await prisma.influencer.create({ data: { displayName: `${tag} Maya`, countryCode: 'KW' } })
    ).id;
    campaignId = (
      await prisma.campaign.create({
        data: {
          brandId,
          name: `${tag} Winter Glow`,
          slug: `${tag.toLowerCase()}-winter`,
          status: 'ACTIVE',
          currency: 'KWD',
          brief: 'Show the serum in daylight. Mention the winter offer.',
          internalNotes: 'Brand is slow to pay — keep this internal.',
          draftReview: true,
        },
      })
    ).id;
    saraRow = (
      await prisma.campaignInfluencer.create({
        data: {
          campaignId,
          influencerId: sara,
          dealType: 'PAID',
          agreedCost: 250,
          participationStatus: 'CONFIRMED',
          notes: 'Negotiated hard',
        },
      })
    ).id;
    mayaRow = (
      await prisma.campaignInfluencer.create({
        data: { campaignId, influencerId: maya, participationStatus: 'CONFIRMED' },
      })
    ).id;
    const script = await prisma.scriptReference.create({
      data: {
        campaignId,
        title: 'Serum reel',
        currentVersion: 2,
        approvedVersion: 1,
        versions: {
          create: [
            {
              version: 1,
              body: 'Approved script body',
              dos: ['Natural light'],
              hashtags: ['#glow'],
              internalComments: 'Brand wanted cheaper talent',
            },
            { version: 2, body: 'Unapproved rewrite' },
          ],
        },
      },
    });
    reel = (
      await prisma.deliverable.create({
        data: {
          campaignInfluencerId: saraRow,
          platform: 'INSTAGRAM',
          type: 'REEL',
          dueDate: new Date('2026-10-10T09:00:00Z'),
          requirements: 'Tag the brand',
          requiredHashtags: ['#ad'],
          scriptReferenceId: script.id,
          internalNotes: 'Pay only after approval',
        },
      })
    ).id;
    story = (
      await prisma.deliverable.create({
        data: { campaignInfluencerId: saraRow, platform: 'INSTAGRAM', type: 'STORY' },
      })
    ).id;
    mayaTask = (
      await prisma.deliverable.create({
        data: { campaignInfluencerId: mayaRow, platform: 'TIKTOK', type: 'VIDEO' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.activityLog.deleteMany({ where: { campaignId } });
    await prisma.brand.deleteMany({ where: { id: { in: [brandId, otherBrandId] } } });
    await prisma.influencer.deleteMany({ where: { id: { in: [sara, maya] } } });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  it("shows a creator their brief, tasks and approved script — nothing about money, internal notes or others' work", async () => {
    const link = await api.creatorLinks.create(saraRow, {});
    expect(link).toMatchObject({
      campaignInfluencerId: saraRow,
      locale: 'ar',
      active: true,
      openCount: 0,
    });
    expect(link.path).toMatch(/^\/share\/c\/[A-Za-z0-9_-]{43}$/);
    expect((new Date(link.expiresAt!).getTime() - Date.now()) / 86_400_000).toBeGreaterThan(89.9);

    const creator = await clientFor(app, { 'user-agent': PERSON });
    const page = await creator.creatorLinks.portal(tokenOf(link.path));
    expect(page).toMatchObject({
      locale: 'ar',
      creatorName: `${tag} Sara`,
      campaign: {
        name: `${tag} Winter Glow`,
        brandName: `${tag} Glow`,
        brief: 'Show the serum in daylight. Mention the winter offer.',
        draftReview: true,
      },
    });
    expect(page.tasks.map((t) => t.id)).toEqual([reel, story]); // due date first; never Maya's
    const task = page.tasks[0]!;
    expect(task).toMatchObject({
      type: 'REEL',
      requirements: 'Tag the brand',
      requiredHashtags: ['#ad'],
      canSendDraft: true,
      canSendPost: true,
    });
    expect(task.script).toMatchObject({
      title: 'Serum reel',
      version: 1,
      body: 'Approved script body',
      dos: ['Natural light'],
    });
    const raw = JSON.stringify(page);
    for (const secret of [
      'Pay only after approval',
      'Brand is slow',
      'Negotiated hard',
      'cheaper talent',
      'Unapproved rewrite',
      '250',
    ]) {
      expect(raw).not.toContain(secret);
    }
    // A person's visit counts; a link preview doesn't.
    await (
      await clientFor(app, { 'user-agent': 'WhatsApp/2.24.1 A' })
    ).creatorLinks.portal(tokenOf(link.path));
    const listed = (await api.creatorLinks.list(saraRow)).find((l) => l.id === link.id)!;
    expect(listed.openCount).toBe(1);
  });

  it('the creator sends a draft; the team reviews it; the creator sees the feedback and sends again', async () => {
    const [link] = await api.creatorLinks.list(saraRow);
    const token = tokenOf(link!.path);
    const creator = await clientFor(app, { 'user-agent': PERSON });

    const after = await creator.creatorLinks.sendDraft(token, reel, {
      assetUrl: 'https://drive.example.com/v1',
      caption: 'Glow up',
      notes: 'First cut',
    });
    const task = after.tasks.find((t) => t.id === reel)!;
    expect(task.status).toBe('IN_REVIEW');
    expect(task.canSendDraft).toBe(false);
    expect(task.drafts[0]).toMatchObject({
      version: 1,
      status: 'IN_REVIEW',
      fromCreator: true,
      assetUrl: 'https://drive.example.com/v1',
    });
    // One draft at a time.
    expect(
      await status(
        creator.creatorLinks.sendDraft(token, reel, { assetUrl: 'https://drive.example.com/v1b' }),
      ),
    ).toBe(409);

    // The team sees it, marked as sent by the creator, and asks for changes.
    const subs = await api.deliverables.submissions(reel);
    expect(subs[0]).toMatchObject({ version: 1, fromCreator: true, submittedByName: null });
    await api.submissions.review(subs[0]!.id, {
      decision: 'REQUEST_CHANGES',
      note: 'Brighter light please',
    });
    const notice = await prisma.notification.findFirst({
      where: { campaignId, title: 'Draft sent by the creator' },
    });
    expect(notice?.targetUrl).toBe(`/campaigns/${campaignId}?tab=submissions`);
    const activity = await prisma.activityLog.findFirst({
      where: { deliverableId: reel, message: { contains: 'from their task link' } },
    });
    expect(activity?.actorId).toBeNull();

    const seen = (await creator.creatorLinks.portal(token)).tasks.find((t) => t.id === reel)!;
    expect(seen.drafts[0]).toMatchObject({
      status: 'CHANGES_REQUESTED',
      feedback: 'Brighter light please',
    });
    expect(seen.canSendDraft).toBe(true);
    const again = await creator.creatorLinks.sendDraft(token, reel, {
      assetUrl: 'https://drive.example.com/v2',
    });
    expect(again.tasks.find((t) => t.id === reel)!.drafts.map((d) => d.version)).toEqual([2, 1]);

    // Links must be real web links.
    expect(
      await status(
        creator.creatorLinks.sendDraft(token, story, { assetUrl: 'javascript:alert(1)' }),
      ),
    ).toBe(422);
  });

  it("sends the live post link for the team to add; never touches another creator's task", async () => {
    const [link] = await api.creatorLinks.list(saraRow);
    const token = tokenOf(link!.path);
    const creator = await clientFor(app, { 'user-agent': PERSON });
    const after = await creator.creatorLinks.sendPost(token, story, {
      url: 'https://www.instagram.com/stories/sara/123',
    });
    expect(after.tasks.find((t) => t.id === story)).toMatchObject({
      postUrl: 'https://www.instagram.com/stories/sara/123',
    });
    const roster = await api.campaigns.influencers(campaignId);
    const d = roster.find((r) => r.id === saraRow)!.deliverables.find((x) => x.id === story)!;
    expect(d).toMatchObject({
      creatorPostUrl: 'https://www.instagram.com/stories/sara/123',
      status: 'PLANNED',
      publishedUrl: null,
    });

    expect(
      await status(
        creator.creatorLinks.sendDraft(token, mayaTask, {
          assetUrl: 'https://drive.example.com/x',
        }),
      ),
    ).toBe(404);
    expect(
      await status(
        creator.creatorLinks.sendPost(token, mayaTask, { url: 'https://tiktok.com/@maya/video/1' }),
      ),
    ).toBe(404);
  });

  it('only people who manage creators or campaigns make links; other brands see nothing', async () => {
    const ops = await staff('ops', 'OPERATIONS_MANAGER');
    expect(await status(ops.creatorLinks.list(saraRow))).toBe(403);
    expect(await status(ops.creatorLinks.create(saraRow, {}))).toBe(403);
    const im = await staff('im', 'INFLUENCER_MANAGER');
    expect(
      (await im.creatorLinks.create(mayaRow, { locale: 'en', expiresInDays: null })).expiresAt,
    ).toBeNull();
    const scoped = await staff('scoped', 'GENERAL_MANAGER', [otherBrandId]);
    expect(await status(scoped.creatorLinks.list(saraRow))).toBe(404);
    const [link] = await api.creatorLinks.list(saraRow);
    expect(await status(scoped.creatorLinks.revoke(link!.id))).toBe(404);
  });

  it('stops working when turned off, expired, or the creator leaves the campaign', async () => {
    const creator = await clientFor(app, { 'user-agent': PERSON });
    const a = await api.creatorLinks.create(saraRow, {});
    const off = await api.creatorLinks.revoke(a.id);
    expect(off.active).toBe(false);
    expect(await status(creator.creatorLinks.portal(tokenOf(a.path)))).toBe(404);
    expect(
      await status(
        creator.creatorLinks.sendDraft(tokenOf(a.path), story, {
          assetUrl: 'https://drive.example.com/z',
        }),
      ),
    ).toBe(404);

    const b = await api.creatorLinks.create(saraRow, { expiresInDays: 1 });
    await prisma.creatorAccessLink.update({
      where: { id: b.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await status(creator.creatorLinks.portal(tokenOf(b.path)))).toBe(404);

    const c = await api.creatorLinks.create(mayaRow, {});
    expect(await status(creator.creatorLinks.portal(tokenOf(c.path)))).toBe(200);
    await prisma.campaignInfluencer.update({
      where: { id: mayaRow },
      data: { participationStatus: 'DROPPED' },
    });
    expect(await status(creator.creatorLinks.portal(tokenOf(c.path)))).toBe(404);

    expect(await status(creator.creatorLinks.portal('x'.repeat(43)))).toBe(404);
  });
});
