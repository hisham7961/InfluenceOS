import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@influenceos/api-client';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P3.7 — suggested creators on a campaign's sourcing list: ranked by plain
 * rules with their reasons, never someone already on the roster or the list,
 * nobody ruled out or inactive, within scope; one click adds them as a
 * candidate with the match as their fit score.
 */
describe('P3.7 — suggested creators', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let admin: Awaited<ReturnType<typeof clientFor>>;
  let scoped: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const creators: Record<string, string> = {};
  const tag = `P37S${Date.now()}`;
  let brandId: string;
  let campaignId: string;

  async function status(p: Promise<unknown>) {
    try {
      await p;
      return 200;
    } catch (e) {
      return (e as ApiError).status;
    }
  }

  async function userClient(label: string, opts: { brandId?: string; country?: string }) {
    const { hash } = await import('@node-rs/argon2');
    const email = `${tag.toLowerCase()}_${label}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: { email, name: `${tag} ${label}`, role: 'STAFF', roleProfile: 'INFLUENCER_MANAGER', passwordHash: await hash(password) },
    });
    users.push(user.id);
    if (opts.brandId) await prisma.userBrandAccess.create({ data: { userId: user.id, brandId: opts.brandId } });
    if (opts.country) await prisma.userCountryAccess.create({ data: { userId: user.id, countryCode: opts.country } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    const { accessToken } = (res.json() as { tokens: { accessToken: string } }).tokens;
    return clientFor(app, { authorization: `Bearer ${accessToken}` });
  }

  async function creator(
    key: string,
    countryCode: string,
    opts: {
      platform?: 'INSTAGRAM' | 'TIKTOK';
      er?: number;
      kwShare?: number;
      collaborations?: number;
      brandStatus?: 'PROSPECT' | 'DECLINED';
      status?: 'PROSPECT' | 'BLACKLISTED';
      isActive?: boolean;
    } = {},
  ) {
    const inf = await prisma.influencer.create({
      data: {
        displayName: `${tag} ${key}`,
        countryCode,
        relationshipStatus: opts.status ?? 'PROSPECT',
        isActive: opts.isActive ?? true,
      },
    });
    creators[key] = inf.id;
    await prisma.brandInfluencer.create({
      data: {
        brandId,
        influencerId: inf.id,
        totalCollaborations: opts.collaborations ?? 0,
        relationshipStatus: opts.brandStatus ?? 'PROSPECT',
      },
    });
    const account = await prisma.socialAccount.create({
      data: {
        influencerId: inf.id,
        platform: opts.platform ?? 'TIKTOK',
        username: `${tag}_${key}`.toLowerCase(),
        followers: 10_000,
        engagementRate: opts.er ?? null,
      },
    });
    if (opts.kwShare != null) {
      await prisma.audienceInsight.create({
        data: {
          socialAccountId: account.id,
          capturedAt: new Date('2026-09-01'),
          isLatest: true,
          countries: { create: [{ countryCode: 'KW', pct: opts.kwShare }] },
        },
      });
    }
    return inf.id;
  }

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    users.push(a.userId);
    admin = await clientFor(app, a.auth);
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    brandId = (await prisma.brand.create({ data: { name: `${tag} Brand`, slug: `${tag.toLowerCase()}-b` } })).id;
    campaignId = (
      await prisma.campaign.create({
        data: { brandId, name: `${tag} Campaign`, slug: `${tag.toLowerCase()}-c`, marketCountryCodes: ['KW'] },
      })
    ).id;

    await creator('Aya', 'KW', { platform: 'INSTAGRAM', er: 5.5, kwShare: 60 });
    await creator('Badr', 'SA', { kwShare: 30 });
    await creator('Huda', 'SA', { collaborations: 2 });
    await creator('Eman', 'EG', { er: 4 });
    await creator('Nour', 'EG');
    await creator('Blocked', 'KW', { status: 'BLACKLISTED', er: 6 });
    await creator('Declined', 'KW', { brandStatus: 'DECLINED', er: 6 });
    await creator('Gone', 'KW', { isActive: false, er: 6 });
    const onRoster = await creator('Roster', 'KW', { er: 6 });
    const listed = await creator('Listed', 'KW', { er: 6 });
    const ci = await prisma.campaignInfluencer.create({ data: { campaignId, influencerId: onRoster } });
    await prisma.deliverable.create({ data: { campaignInfluencerId: ci.id, platform: 'INSTAGRAM', type: 'REEL' } });
    await prisma.campaignCandidate.create({ data: { campaignId, influencerId: listed } });

    // Scoped to this brand only, so the ranking is just these creators.
    scoped = await userClient('brand', { brandId });
  });

  afterAll(async () => {
    await prisma.brand.deleteMany({ where: { id: brandId } });
    await prisma.influencer.deleteMany({ where: { id: { in: Object.values(creators) } } });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  it('ranks by the rules, with the reasons, leaving out who is taken or ruled out', async () => {
    const res = await scoped.campaigns.candidateSuggestions(campaignId, { limit: 30 });
    expect(res.markets).toEqual(['KW']);
    expect(res.platforms).toEqual(['INSTAGRAM']);
    const byName = res.suggestions.map((s) => [s.influencer.displayName.replace(`${tag} `, ''), s.score]);
    expect(byName).toEqual([
      ['Aya', 30 + 15 + 15 + 10],
      ['Huda', 17],
      ['Badr', 15],
      ['Eman', 10],
    ]);
    expect(res.suggestions[0]!.reasons).toEqual([
      { code: 'AUDIENCE_IN_MARKET', pct: 60, countryCode: 'KW' },
      { code: 'BASED_IN_MARKET', countryCode: 'KW' },
      { code: 'HIGH_ENGAGEMENT', pct: 5.5 },
      { code: 'PLATFORM_MATCH', platform: 'INSTAGRAM' },
    ]);
    expect(res.suggestions[1]!.reasons).toEqual([{ code: 'WORKED_WITH_BRAND', campaigns: 2 }]);
  });

  it('adding a suggestion makes them a candidate and takes them off the list', async () => {
    const [top] = (await scoped.campaigns.candidateSuggestions(campaignId)).suggestions;
    const added = await scoped.campaigns.addCandidate(campaignId, {
      influencerId: top!.influencer.id,
      fitScore: top!.score,
    });
    expect(added).toMatchObject({ status: 'CONSIDERING', fitScore: 70 });
    const after = await scoped.campaigns.candidateSuggestions(campaignId);
    expect(after.suggestions.map((s) => s.influencer.id)).not.toContain(top!.influencer.id);
  });

  it('keeps to scope', async () => {
    // Only Saudi creators for a Saudi-only user.
    const sa = await userClient('sa', { country: 'SA' });
    const names = (await sa.campaigns.candidateSuggestions(campaignId, { limit: 30 })).suggestions
      .filter((s) => s.influencer.displayName.startsWith(tag))
      .map((s) => s.influencer.displayName.replace(`${tag} `, ''));
    expect(names.sort()).toEqual(['Badr', 'Huda']);
    // …and they can't add a Kuwaiti creator as a candidate either.
    expect(await status(sa.campaigns.addCandidate(campaignId, { influencerId: creators.Nour! }))).toBe(404);
    // Another brand's user can't see the campaign at all.
    const other = await prisma.brand.create({ data: { name: `${tag} Other`, slug: `${tag.toLowerCase()}-o` } });
    try {
      const outsider = await userClient('outsider', { brandId: other.id });
      expect(await status(outsider.campaigns.candidateSuggestions(campaignId))).toBe(404);
    } finally {
      await prisma.brand.delete({ where: { id: other.id } });
    }
    expect((await admin.campaigns.candidateSuggestions(campaignId, { limit: 1 })).suggestions).toHaveLength(1);
  });
});
