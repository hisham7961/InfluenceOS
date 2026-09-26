import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P3.6 — My work and approvals: what's waiting on a person comes from what
 * they own (their campaigns, their creators) plus logistics assigned to
 * them; the approvals list spans campaigns, can narrow to "mine", and keeps
 * to brand and country scope.
 */
describe('P3.6 — my work and approvals', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let admin: Awaited<ReturnType<typeof loginFresh>>;
  let api: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const tag = `P36W${Date.now()}`;
  const DAY = 864e5;
  let brandId: string;
  let otherBrandId: string;
  let ownedCampaign: string;
  let otherCampaign: string;
  let foreignCampaign: string;
  let sara: string;
  let maya: string;
  let nora: string;
  let me: { id: string; api: Awaited<ReturnType<typeof clientFor>> };

  async function staff(label: string, brands: string[] = []) {
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
    return { id: user.id, api: await clientFor(app, { authorization: `Bearer ${accessToken}` }) };
  }

  async function draft(
    ciId: string,
    type: 'REEL' | 'POST',
    dueInDays: number | null,
    waiting = true,
  ) {
    const d = await prisma.deliverable.create({
      data: {
        campaignInfluencerId: ciId,
        platform: 'INSTAGRAM',
        type,
        status: waiting ? 'IN_REVIEW' : 'PLANNED',
        dueDate: dueInDays === null ? null : new Date(Date.now() + dueInDays * DAY),
      },
    });
    if (waiting)
      await prisma.deliverableSubmission.create({
        data: { deliverableId: d.id, version: 1, status: 'IN_REVIEW', caption: 'draft' },
      });
    return d.id;
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
    me = await staff('me', [brandId]);

    const mk = async (name: string, ownerId: string | null) =>
      (
        await prisma.influencer.create({
          data: { displayName: `${tag} ${name}`, countryCode: 'KW', ownerId },
        })
      ).id;
    sara = await mk('Sara', null);
    maya = await mk('Maya', me.id); // my creator
    nora = await mk('Nora', null);
    const campaign = async (name: string, ownerId: string | null, brand = brandId) =>
      (
        await prisma.campaign.create({
          data: {
            brandId: brand,
            name: `${tag} ${name}`,
            slug: `${tag.toLowerCase()}-${name.toLowerCase()}`,
            status: 'ACTIVE',
            ownerId,
          },
        })
      ).id;
    ownedCampaign = await campaign('Mine', me.id);
    otherCampaign = await campaign('Theirs', admin.userId);
    foreignCampaign = await campaign('Foreign', me.id, otherBrandId);
    const row = (campaignId: string, influencerId: string) =>
      prisma.campaignInfluencer.create({
        data: { campaignId, influencerId, participationStatus: 'CONFIRMED' },
      });
    const saraMine = (await row(ownedCampaign, sara)).id; // mine via the campaign
    const mayaTheirs = (await row(otherCampaign, maya)).id; // mine via the creator
    const noraTheirs = (await row(otherCampaign, nora)).id; // not mine
    const saraForeign = (await row(foreignCampaign, sara)).id; // mine but outside my brand scope

    await draft(saraMine, 'REEL', 5); // draft to review (mine)
    await draft(mayaTheirs, 'POST', 5); // draft to review (mine via creator)
    await draft(noraTheirs, 'REEL', 5); // someone else's
    await draft(saraForeign, 'REEL', 5); // out of scope
    await draft(saraMine, 'POST', -3, false); // overdue (mine)
    await draft(mayaTheirs, 'REEL', 1, false); // due soon (mine)
    await draft(noraTheirs, 'POST', -2, false); // overdue, not mine

    // A shipment and an address issue assigned to me, on someone else's campaign.
    const shipment = await prisma.productShipment.create({
      data: { campaignInfluencerId: noraTheirs, status: 'PENDING', assignedToUserId: me.id },
    });
    await prisma.logisticsIssue.create({
      data: {
        shipmentId: shipment.id,
        type: 'MISSING_ADDRESS',
        status: 'OPEN',
        assignedToUserId: me.id,
        description: 'x',
      },
    });
    // Two found posts on my campaign.
    for (const n of [1, 2]) {
      await prisma.discoveredPost.create({
        data: {
          platform: 'INSTAGRAM',
          externalId: `${tag}-${n}`,
          url: `https://www.instagram.com/p/${tag}${n}/`,
          influencerId: sara,
          campaignId: ownedCampaign,
          campaignInfluencerId: saraMine,
          signals: ['brand'],
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.activityLog.deleteMany({
      where: { campaignId: { in: [ownedCampaign, otherCampaign, foreignCampaign] } },
    });
    await prisma.brand.deleteMany({ where: { id: { in: [brandId, otherBrandId] } } });
    await prisma.influencer.deleteMany({ where: { id: { in: [sara, maya, nora] } } });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  it('lists what I own and what is assigned to me, and nothing else', async () => {
    const work = await me.api.work.mine();
    expect(work.ownsAnything).toBe(true);
    const by = (kind: string) => work.items.filter((i) => i.kind === kind);
    expect(
      by('DRAFT_TO_REVIEW')
        .map((i) => i.creator?.name)
        .sort(),
    ).toEqual([`${tag} Maya`, `${tag} Sara`]);
    expect(by('DELIVERABLE_OVERDUE').map((i) => [i.creator?.name, i.params.type])).toEqual([
      [`${tag} Sara`, 'POST'],
    ]);
    expect(by('DELIVERABLE_DUE_SOON').map((i) => [i.creator?.name, i.params.type])).toEqual([
      [`${tag} Maya`, 'REEL'],
    ]);
    expect(by('SHIPMENT').map((i) => [i.creator?.name, i.params.status])).toEqual([
      [`${tag} Nora`, 'PENDING'],
    ]);
    expect(by('LOGISTICS_ISSUE').map((i) => i.params.issueType)).toEqual(['MISSING_ADDRESS']);
    expect(by('FOUND_POSTS')).toEqual([
      expect.objectContaining({
        campaign: { id: ownedCampaign, name: `${tag} Mine` },
        params: { count: 2 },
        link: `/campaigns/${ownedCampaign}?tab=content`,
      }),
    ]);
    // The out-of-scope campaign never shows, even though I own it.
    expect(work.items.some((i) => i.campaign?.id === foreignCampaign)).toBe(false);

    expect(await me.api.work.counts()).toEqual({ myWork: 7, approvals: 3 });
  });

  it('approvals span campaigns, oldest first, and narrow to mine', async () => {
    const all = await me.api.work.approvals();
    expect(all.map((a) => a.creator.name)).toEqual([`${tag} Sara`, `${tag} Maya`, `${tag} Nora`]);
    expect(all.map((a) => a.mine)).toEqual([true, true, false]);
    expect(all[0]).toMatchObject({
      campaign: { id: ownedCampaign, name: `${tag} Mine` },
      brandName: `${tag} Glow`,
      deliverable: { type: 'REEL', platform: 'INSTAGRAM' },
      submission: { status: 'IN_REVIEW', version: 1, caption: 'draft' },
    });
    const mine = await me.api.work.approvals({ mine: true });
    expect(mine.map((a) => a.creator.name)).toEqual([`${tag} Sara`, `${tag} Maya`]);

    // An admin sees the out-of-scope one too.
    const everything = (await api.work.approvals()).filter((a) => a.brandName.startsWith(tag));
    expect(everything).toHaveLength(4);
  });

  it('someone who owns nothing sees only what is assigned to them', async () => {
    const newbie = await staff('newbie', [brandId]);
    const work = await newbie.api.work.mine();
    expect(work).toEqual({ items: [], ownsAnything: false });
    expect((await newbie.api.work.counts()).myWork).toBe(0);
  });
});
