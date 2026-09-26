import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@influenceos/api-client';
import { checkCaption } from '@influenceos/shared';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P3.5 — caption check: what a deliverable's caption must carry (its own
 * and the approved script's hashtags/mentions, and the ad disclosure for
 * paid or gifted work that the creator posts), the same rules on the
 * creator's task link, and one Needs Attention line per running campaign
 * with live posts that don't say they're ads.
 */
describe('P3.5 — caption check', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let admin: Awaited<ReturnType<typeof loginFresh>>;
  let api: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const tag = `P35C${Date.now()}`;
  let brandId: string;
  let otherBrandId: string;
  let campaignId: string;
  let sara: string;
  let maya: string;
  let saraRow: string;
  let reel: string;
  let ugc: string;
  let mayaPost: string;

  async function staff(label: string, brands: string[]) {
    const { hash } = await import('@node-rs/argon2');
    const email = `${tag.toLowerCase()}_${label}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: {
        email,
        name: `${tag} ${label}`,
        role: 'STAFF',
        roleProfile: 'INFLUENCER_MANAGER',
        passwordHash: await hash(password),
      },
    });
    users.push(user.id);
    for (const b of brands)
      await prisma.userBrandAccess.create({ data: { userId: user.id, brandId: b } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const { accessToken } = (res.json() as { tokens: { accessToken: string } }).tokens;
    return clientFor(app, { authorization: `Bearer ${accessToken}` });
  }

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
          name: `${tag} Winter`,
          slug: `${tag.toLowerCase()}-winter`,
          status: 'ACTIVE',
          currency: 'KWD',
        },
      })
    ).id;
    saraRow = (
      await prisma.campaignInfluencer.create({
        data: {
          campaignId,
          influencerId: sara,
          dealType: 'PAID',
          participationStatus: 'CONFIRMED',
        },
      })
    ).id;
    const mayaRow = (
      await prisma.campaignInfluencer.create({
        data: {
          campaignId,
          influencerId: maya,
          dealType: 'FREE',
          participationStatus: 'CONFIRMED',
        },
      })
    ).id;
    const script = await prisma.scriptReference.create({
      data: {
        campaignId,
        title: 'Winter script',
        currentVersion: 2,
        approvedVersion: 1,
        versions: {
          create: [
            {
              version: 1,
              status: 'APPROVED',
              hashtags: ['#Winter', 'glowup'],
              mentions: ['@sara'],
            },
            { version: 2, status: 'DRAFT', hashtags: ['#NotYet'], mentions: [] },
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
          requiredHashtags: ['GlowUp', '#غلو'],
          requiredMentions: ['glowkw'],
          scriptReferenceId: script.id,
        },
      })
    ).id;
    ugc = (
      await prisma.deliverable.create({
        data: {
          campaignInfluencerId: saraRow,
          platform: 'INSTAGRAM',
          type: 'UGC',
          requiredHashtags: [],
        },
      })
    ).id;
    const mayaReel = (
      await prisma.deliverable.create({
        data: {
          campaignInfluencerId: mayaRow,
          platform: 'INSTAGRAM',
          type: 'REEL',
          requiredHashtags: ['GlowUp'],
        },
      })
    ).id;

    // Live posts: one of Sara's without a disclosure, one with; Maya's is FREE work.
    const post = (
      url: string,
      caption: string,
      ci: string,
      deliverableId: string,
      influencerId: string,
    ) =>
      prisma.publishedContent.create({
        data: {
          platform: 'INSTAGRAM',
          originalUrl: url,
          caption,
          brandId,
          campaignId,
          influencerId,
          campaignInfluencerId: ci,
          deliverableId,
          availabilityStatus: 'LIVE',
        },
      });
    await post(
      `https://www.instagram.com/p/${tag}a/`,
      'Winter glow #GlowUp @glowkw',
      saraRow,
      reel,
      sara,
    );
    await post(
      `https://www.instagram.com/p/${tag}b/`,
      'روتيني #GlowUp #إعلان',
      saraRow,
      reel,
      sara,
    );
    mayaPost = (
      await post(
        `https://www.instagram.com/p/${tag}c/`,
        'Just love it #GlowUp',
        mayaRow,
        mayaReel,
        maya,
      )
    ).id;
  });

  afterAll(async () => {
    await prisma.publishedContent.deleteMany({ where: { campaignId } });
    await prisma.activityLog.deleteMany({ where: { campaignId } });
    await prisma.brand.deleteMany({ where: { id: { in: [brandId, otherBrandId] } } });
    await prisma.influencer.deleteMany({ where: { id: { in: [sara, maya] } } });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  it("merges the deliverable's and the approved script's tags, and asks paid work to say it's an ad", async () => {
    const rules = await api.deliverables.captionRules(reel);
    expect(rules).toEqual({
      hashtags: ['#GlowUp', '#غلو', '#Winter'],
      mentions: ['@glowkw', '@sara'],
      disclosureRequired: true,
    });
    // The unapproved script version's tag doesn't count.
    expect(rules.hashtags).not.toContain('#NotYet');

    const check = checkCaption('Winter glow #glowup #Winter @GlowKW', rules);
    expect(check.ok).toBe(false);
    expect(check.hashtags.filter((h) => !h.present).map((h) => h.tag)).toEqual(['#غلو']);
    expect(check.mentions.filter((m) => !m.present).map((m) => m.handle)).toEqual(['@sara']);
    expect(check.disclosure).toEqual({ required: true, present: false });
  });

  it("UGC (posted by the brand) and FREE work don't need a disclosure", async () => {
    expect((await api.deliverables.captionRules(ugc)).disclosureRequired).toBe(false);
    const content = await prisma.publishedContent.findUniqueOrThrow({
      where: { id: mayaPost },
      select: { deliverableId: true },
    });
    expect((await api.deliverables.captionRules(content.deliverableId!)).disclosureRequired).toBe(
      false,
    );
  });

  it('the creator sees the same rules on their task link', async () => {
    const link = await api.creatorLinks.create(saraRow, { locale: 'en' });
    const portal = await api.creatorLinks.portal(link.path.replace('/share/c/', ''), {
      preview: '1',
    });
    const task = portal.tasks.find((t) => t.id === reel)!;
    expect(task.captionRules).toEqual(await api.deliverables.captionRules(reel));
    expect(portal.tasks.find((t) => t.id === ugc)!.captionRules.disclosureRequired).toBe(false);
  });

  it('raises one Needs Attention line for live paid posts without a disclosure', async () => {
    const items = await api.dashboard.attention({ campaignId });
    const item = items.find((i) => i.kind === 'DISCLOSURE_MISSING');
    expect(item).toMatchObject({
      severity: 'danger',
      campaignId,
      brandId,
      link: `/campaigns/${campaignId}?tab=content`,
      params: { campaignName: `${tag} Winter`, count: 1 },
    });

    // Fixing the caption clears it.
    await prisma.publishedContent.updateMany({
      where: { campaignId, caption: 'Winter glow #GlowUp @glowkw' },
      data: { caption: 'Winter glow #GlowUp @glowkw #ad' },
    });
    expect(
      (await api.dashboard.attention({ campaignId })).some((i) => i.kind === 'DISCLOSURE_MISSING'),
    ).toBe(false);
  });

  it('keeps to brand scope', async () => {
    const outsider = await staff('outsider', [otherBrandId]);
    await expect(outsider.deliverables.captionRules(reel)).rejects.toBeInstanceOf(ApiError);
    try {
      await outsider.deliverables.captionRules(reel);
    } catch (e) {
      expect((e as ApiError).status).toBe(404);
    }
    const insider = await staff('insider', [brandId]);
    expect((await insider.deliverables.captionRules(reel)).hashtags).toContain('#GlowUp');
  });
});
