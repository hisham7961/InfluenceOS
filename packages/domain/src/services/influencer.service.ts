import { metrics as sharedMetrics, type Platform } from '@influenceos/shared';
import {
  buildOffsetPagination,
  requests,
  type InfluencerDetailDTO,
  type InfluencerSummaryDTO,
  type Paginated,
  type SocialAccountDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { dec, iso, logActivity } from '../lib/helpers';
import { toInfluencerSummary, toSocialAccountDTO } from '../lib/mappers';

const { assessAudienceHealth } = sharedMetrics;

type InfluencerCreate = z.infer<typeof requests.influencerCreateSchema>;
type InfluencerUpdate = z.infer<typeof requests.influencerUpdateSchema>;
type InfluencerFilter = z.infer<typeof requests.influencerFilterSchema>;

const summaryInclude = {
  socialAccounts: {
    select: { platform: true, followers: true, isPrimary: true, avatarUrl: true },
  },
  tags: { include: { tag: { select: { name: true } } } },
} satisfies Prisma.InfluencerInclude;

export function makeInfluencerService(ctx: DomainContext) {
  const { prisma } = ctx;

  function buildWhere(filter: InfluencerFilter): Prisma.InfluencerWhereInput {
    const and: Prisma.InfluencerWhereInput[] = [];
    if (filter.active !== undefined) and.push({ isActive: filter.active });
    if (filter.relationshipStatus) and.push({ relationshipStatus: filter.relationshipStatus });
    if (filter.country) and.push({ country: { equals: filter.country, mode: 'insensitive' } });
    if (filter.category) and.push({ category: { equals: filter.category, mode: 'insensitive' } });
    if (filter.brandId) and.push({ brandInfluencers: { some: { brandId: filter.brandId } } });
    if (filter.campaignId)
      and.push({ campaignInfluencers: { some: { campaignId: filter.campaignId } } });
    if (filter.tag) and.push({ tags: { some: { tag: { name: filter.tag } } } });
    if (filter.platform) and.push({ socialAccounts: { some: { platform: filter.platform } } });
    if (filter.dealHistory && filter.dealHistory !== 'ANY') {
      const deal = filter.dealHistory === 'FREE' ? 'FREE' : undefined;
      and.push({
        campaignInfluencers: {
          some:
            filter.dealHistory === 'FREE'
              ? { dealType: 'FREE' }
              : { dealType: { in: ['PAID', 'PAID_PLUS_GIFTED'] } },
        },
      });
      void deal;
    }
    if (filter.minFollowers != null || filter.maxFollowers != null) {
      const followers: Prisma.IntFilter = {};
      if (filter.minFollowers != null) followers.gte = filter.minFollowers;
      if (filter.maxFollowers != null) followers.lte = filter.maxFollowers;
      and.push({ socialAccounts: { some: { followers } } });
    }
    if (filter.q) {
      const q = filter.q;
      and.push({
        OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { fullName: { contains: q, mode: 'insensitive' } },
          { primaryUsername: { contains: q, mode: 'insensitive' } },
          { socialAccounts: { some: { username: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }
    return and.length ? { AND: and } : {};
  }

  async function list(filter: InfluencerFilter): Promise<Paginated<InfluencerSummaryDTO>> {
    const where = buildWhere(filter);
    const [total, rows] = await Promise.all([
      prisma.influencer.count({ where }),
      prisma.influencer.findMany({
        where,
        include: summaryInclude,
        orderBy: [{ createdAt: 'desc' }],
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
    ]);

    const ids = rows.map((r) => r.id);
    const activeCounts = new Map<string, number>();
    if (ids.length) {
      const grouped = await prisma.campaignInfluencer.groupBy({
        by: ['influencerId'],
        where: { influencerId: { in: ids }, campaign: { status: 'ACTIVE' } },
        _count: { _all: true },
      });
      for (const g of grouped) activeCounts.set(g.influencerId, g._count._all);
    }

    return {
      data: rows.map((r) =>
        toInfluencerSummary(r, { activeCampaigns: activeCounts.get(r.id) ?? 0 }),
      ),
      pagination: buildOffsetPagination(filter.page, filter.pageSize, total),
    };
  }

  async function followerDelta7d(accountId: string, current: number | null): Promise<number | null> {
    if (current == null) return null;
    const weekAgo = new Date(Date.now() - 7 * 864e5);
    const prior = await prisma.socialMetricSnapshot.findFirst({
      where: { socialAccountId: accountId, capturedAt: { lte: weekAgo }, followers: { not: null } },
      orderBy: { capturedAt: 'desc' },
      select: { followers: true },
    });
    if (!prior?.followers) return null;
    return current - prior.followers;
  }

  async function socialAccountsFor(influencerId: string): Promise<SocialAccountDTO[]> {
    const accounts = await prisma.socialAccount.findMany({
      where: { influencerId },
      orderBy: [{ isPrimary: 'desc' }, { followers: 'desc' }],
    });
    return Promise.all(
      accounts.map(async (a) =>
        toSocialAccountDTO(a, { followerDelta7d: await followerDelta7d(a.id, a.followers) }),
      ),
    );
  }

  async function audienceFor(influencerId: string) {
    const best = await prisma.socialAccount.findFirst({
      where: { influencerId },
      orderBy: [{ isPrimary: 'desc' }, { followers: 'desc' }],
      select: { id: true, followers: true },
    });
    const totalFollowers = await prisma.socialAccount.aggregate({
      where: { influencerId },
      _sum: { followers: true },
    });
    let followerHistory: { followers: number; capturedAt: Date }[] = [];
    if (best) {
      const snaps = await prisma.socialMetricSnapshot.findMany({
        where: { socialAccountId: best.id, followers: { not: null } },
        orderBy: { capturedAt: 'asc' },
        take: 120,
        select: { followers: true, capturedAt: true },
      });
      followerHistory = snaps
        .filter((s) => s.followers != null)
        .map((s) => ({ followers: s.followers as number, capturedAt: s.capturedAt }));
    }
    return assessAudienceHealth({
      followerHistory,
      followers: totalFollowers._sum.followers ?? null,
      engagementRate: null,
      avgViews: null,
    });
  }

  async function detail(id: string): Promise<InfluencerDetailDTO> {
    const inf = await prisma.influencer.findUnique({ where: { id }, include: summaryInclude });
    if (!inf) throw AppError.notFound('Influencer');

    const [socialAccounts, audience, cis] = await Promise.all([
      socialAccountsFor(id),
      audienceFor(id),
      prisma.campaignInfluencer.findMany({
        where: { influencerId: id },
        select: {
          agreedCost: true,
          paymentStatus: true,
          dealType: true,
          createdAt: true,
          campaign: {
            select: {
              id: true,
              startDate: true,
              status: true,
              brand: { select: { id: true, name: true } },
            },
          },
          deliverables: { select: { status: true } },
        },
      }),
    ]);

    // Relationship history (spec §56)
    const brandsMap = new Map<string, string>();
    let firstAt: Date | null = null;
    let lastAt: Date | null = null;
    let totalPaid = 0;
    const paidRates: number[] = [];
    let deliverablesTotal = 0;
    let deliverablesPublished = 0;
    let activeCampaigns = 0;

    for (const ci of cis) {
      brandsMap.set(ci.campaign.brand.id, ci.campaign.brand.name);
      const at = ci.campaign.startDate ?? ci.createdAt;
      if (!firstAt || at < firstAt) firstAt = at;
      if (!lastAt || at > lastAt) lastAt = at;
      if (ci.campaign.status === 'ACTIVE') activeCampaigns += 1;
      const cost = dec(ci.agreedCost);
      if (cost != null && (ci.dealType === 'PAID' || ci.dealType === 'PAID_PLUS_GIFTED')) {
        paidRates.push(cost);
        if (ci.paymentStatus === 'PAID') totalPaid += cost;
      }
      for (const d of ci.deliverables) {
        deliverablesTotal += 1;
        if (d.status === 'PUBLISHED' || d.status === 'VERIFIED') deliverablesPublished += 1;
      }
    }

    // Keep the denormalized audience label current for directory badges.
    if (inf.audienceHealth !== audience.label) {
      await prisma.influencer.update({ where: { id }, data: { audienceHealth: audience.label } });
    }

    const summary = toInfluencerSummary(
      { ...inf, audienceHealth: audience.label },
      { activeCampaigns },
    );

    return {
      ...summary,
      bio: inf.bio,
      city: inf.city,
      languages: inf.languages,
      pricingNotes: inf.pricingNotes,
      internalNotes: inf.internalNotes,
      contact: {
        fullName: inf.fullName,
        email: inf.email,
        mobile: inf.mobile,
        whatsapp: inf.whatsapp,
        managerName: inf.managerName,
        managerContact: inf.managerContact,
        preferredContact: inf.preferredContact,
      },
      socialAccounts,
      audience,
      history: {
        firstCollaborationAt: iso(firstAt),
        lastCollaborationAt: iso(lastAt),
        campaignCount: cis.length,
        brandsWorkedWith: Array.from(brandsMap.entries()).map(([bid, name]) => ({ id: bid, name })),
        totalPaid: paidRates.length ? totalPaid : null,
        averageRate: paidRates.length
          ? Math.round(paidRates.reduce((a, b) => a + b, 0) / paidRates.length)
          : null,
        deliverablesPublished,
        deliverablesTotal,
      },
      createdAt: inf.createdAt.toISOString(),
    };
  }

  async function create(input: InfluencerCreate): Promise<InfluencerDetailDTO> {
    requireActor(ctx);
    const email = input.email === '' ? null : (input.email ?? null);
    const influencer = await prisma.influencer.create({
      data: {
        displayName: input.displayName,
        fullName: input.fullName ?? null,
        primaryUsername: input.primaryUsername ?? null,
        primaryPlatform: (input.primaryPlatform ?? null) as Platform | null,
        avatarOverrideUrl: input.avatarOverrideUrl ?? null,
        bio: input.bio ?? null,
        country: input.country ?? null,
        city: input.city ?? null,
        category: input.category ?? null,
        languages: input.languages ?? [],
        email,
        mobile: input.mobile ?? null,
        whatsapp: input.whatsapp ?? null,
        managerName: input.managerName ?? null,
        managerContact: input.managerContact ?? null,
        preferredContact: input.preferredContact ?? null,
        priority: input.priority ?? 'MEDIUM',
        relationshipStatus: input.relationshipStatus ?? 'PROSPECT',
        pricingNotes: input.pricingNotes ?? null,
        internalNotes: input.internalNotes ?? null,
        isActive: input.isActive ?? true,
      },
    });

    if (input.tags?.length) await setTags(influencer.id, input.tags);

    await logActivity(ctx, {
      type: 'INFLUENCER_ADDED',
      message: `${ctx.actor?.name ?? 'Someone'} added ${influencer.displayName} to the influencer directory.`,
      influencerId: influencer.id,
    });
    return detail(influencer.id);
  }

  async function update(id: string, input: InfluencerUpdate): Promise<InfluencerDetailDTO> {
    requireActor(ctx);
    const existing = await prisma.influencer.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Influencer');
    const email = input.email === '' ? null : input.email;
    await prisma.influencer.update({
      where: { id },
      data: {
        displayName: input.displayName ?? undefined,
        fullName: input.fullName === undefined ? undefined : input.fullName,
        primaryUsername: input.primaryUsername === undefined ? undefined : input.primaryUsername,
        primaryPlatform: input.primaryPlatform === undefined ? undefined : input.primaryPlatform,
        avatarOverrideUrl: input.avatarOverrideUrl === undefined ? undefined : input.avatarOverrideUrl,
        bio: input.bio === undefined ? undefined : input.bio,
        country: input.country === undefined ? undefined : input.country,
        city: input.city === undefined ? undefined : input.city,
        category: input.category === undefined ? undefined : input.category,
        languages: input.languages ?? undefined,
        email: email === undefined ? undefined : email,
        mobile: input.mobile === undefined ? undefined : input.mobile,
        whatsapp: input.whatsapp === undefined ? undefined : input.whatsapp,
        managerName: input.managerName === undefined ? undefined : input.managerName,
        managerContact: input.managerContact === undefined ? undefined : input.managerContact,
        preferredContact: input.preferredContact === undefined ? undefined : input.preferredContact,
        priority: input.priority ?? undefined,
        relationshipStatus: input.relationshipStatus ?? undefined,
        pricingNotes: input.pricingNotes === undefined ? undefined : input.pricingNotes,
        internalNotes: input.internalNotes === undefined ? undefined : input.internalNotes,
        isActive: input.isActive ?? undefined,
      },
    });
    if (input.tags) await setTags(id, input.tags);
    await logActivity(ctx, {
      type: 'INFLUENCER_UPDATED',
      message: `${ctx.actor?.name ?? 'Someone'} updated ${existing.displayName}.`,
      influencerId: id,
    });
    return detail(id);
  }

  async function setTags(influencerId: string, tagNames: string[]) {
    const names = Array.from(new Set(tagNames.map((t) => t.trim()).filter(Boolean)));
    const tags = await Promise.all(
      names.map((name) =>
        prisma.tag.upsert({ where: { name }, update: {}, create: { name } }),
      ),
    );
    await prisma.influencerTag.deleteMany({ where: { influencerId } });
    if (tags.length) {
      await prisma.influencerTag.createMany({
        data: tags.map((t) => ({ influencerId, tagId: t.id })),
        skipDuplicates: true,
      });
    }
  }

  return { list, detail, create, update, socialAccountsFor, audienceFor };
}

export type InfluencerService = ReturnType<typeof makeInfluencerService>;
