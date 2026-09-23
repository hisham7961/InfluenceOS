import { countryName, metrics as sharedMetrics, type Platform } from '@influenceos/shared';
import {
  buildOffsetPagination,
  requests,
  type CursorPage,
  type InfluencerCountrySummaryDTO,
  type InfluencerDetailDTO,
  type InfluencerExportRowDTO,
  type InfluencerSummaryDTO,
  type Paginated,
  type SocialAccountDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireCapability } from '../lib/authz';
import { buildCursorPage } from '../lib/cursor';
import { resolveAvatarUrl } from '../lib/avatar';
import { iso, logActivity } from '../lib/helpers';
import { sumMoney, toDecimal } from '../lib/money';
import { toInfluencerSummary, toSocialAccountDTO } from '../lib/mappers';
import { isCountryOutOfScope, scopedBrandIds, scopedCountryCodes } from '../lib/scope';

const { assessAudienceHealth } = sharedMetrics;

type InfluencerCreate = z.infer<typeof requests.influencerCreateSchema>;
type InfluencerUpdate = z.infer<typeof requests.influencerUpdateSchema>;
type InfluencerFilter = z.infer<typeof requests.influencerFilterSchema>;
type InfluencerCountrySummaryQuery = z.infer<typeof requests.influencerCountrySummarySchema>;
type InfluencerCursorQuery = z.infer<typeof requests.influencerCursorSchema>;
type InfluencerExportQuery = z.infer<typeof requests.influencerExportSchema>;

const summaryInclude = {
  socialAccounts: {
    select: { platform: true, followers: true, isPrimary: true, avatarUrl: true },
  },
  tags: { include: { tag: { select: { name: true } } } },
} satisfies Prisma.InfluencerInclude;

// Export reads the same relations the summary does, plus the owner's name — the
// row scalars (contact, notes-free profile fields) come from the base model.
const exportInclude = {
  socialAccounts: {
    select: { platform: true, followers: true, isPrimary: true, avatarUrl: true },
  },
  tags: { include: { tag: { select: { name: true } } } },
  owner: { select: { name: true } },
} satisfies Prisma.InfluencerInclude;

// Hard ceiling so a filter-less export can never load an unbounded set into
// memory. Well above any realistic directory; a larger tenant would page.
const EXPORT_MAX_ROWS = 50_000;

/**
 * The creator's shipping-profile fields — the ones that materially overlap
 * with what a shipment's own address represents (mirrors shipment.service.ts's
 * redactWith(): phone/addressLine1/addressLine2/postalCode/deliveryInstructions
 * are gated behind LOGISTICS_ADDRESS_VIEW/EDIT there, while city/country stay
 * visible — "general location, not PII-sensitive"). `city` and `countryCode`
 * are deliberately excluded here for the same reason (plus countryCode is a
 * directory/scoping field the Influencer Manager legitimately owns), and so
 * is `mobile` — it's a general contact field used broadly across the app,
 * not shipping-specific, so restricting it would over-restrict a routine
 * profile edit. See update(), below (Security & Authorization Freeze Gate §16).
 */
const INFLUENCER_SHIPPING_ADDRESS_FIELDS = [
  'addressLine1',
  'addressLine2',
  'postalCode',
  'deliveryInstructions',
] as const satisfies readonly (keyof InfluencerUpdate)[];

function touchesShippingAddressFields(input: InfluencerUpdate): boolean {
  return INFLUENCER_SHIPPING_ADDRESS_FIELDS.some((key) => input[key] !== undefined);
}

export function makeInfluencerService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function buildWhere(
    filter: Omit<InfluencerFilter, 'page' | 'pageSize'>,
    opts: { ignoreCountryFilter?: boolean } = {},
  ): Promise<Prisma.InfluencerWhereInput> {
    const and: Prisma.InfluencerWhereInput[] = [];
    if (filter.active !== undefined) and.push({ isActive: filter.active });
    if (filter.relationshipStatus) and.push({ relationshipStatus: filter.relationshipStatus });
    if (filter.country) and.push({ country: { equals: filter.country, mode: 'insensitive' } });
    if (filter.city) and.push({ city: { equals: filter.city, mode: 'insensitive' } });
    if (filter.ownerId) and.push({ ownerId: filter.ownerId === 'unowned' ? null : filter.ownerId });
    if (filter.category) and.push({ category: { equals: filter.category, mode: 'insensitive' } });

    // Data Quality Center deep-links — each mirrors exactly the condition
    // data-quality.service.ts's report() counts, so a finding's count and
    // its filtered destination here never disagree.
    if (filter.missingCountry) and.push({ countryCode: null });
    if (filter.missingOwner) and.push({ ownerId: null });
    if (filter.missingPhone) and.push({ mobile: null });
    if (filter.missingSocial) and.push({ socialAccounts: { none: {} } });

    // Brand scope (W4-4) — composed server-side into every directory query,
    // same posture as every other brand-touching service (content.service.ts,
    // shipment.service.ts, analytics.service.ts): an out-of-scope explicit
    // brandId filter matches nothing rather than silently widening; an
    // unscoped actor (ADMIN, or no explicit UserBrandAccess rows) is untouched.
    const brandScope = await scopedBrandIds(ctx);
    if (brandScope) {
      and.push({
        brandInfluencers: {
          some: { brandId: filter.brandId ? (brandScope.includes(filter.brandId) ? filter.brandId : { in: [] }) : { in: brandScope } },
        },
      });
    } else if (filter.brandId) {
      and.push({ brandInfluencers: { some: { brandId: filter.brandId } } });
    }

    // Country scope (Advanced Roles & Logistics Operations pass) — composed
    // server-side into every directory query, never a client-side post-filter
    // of a downloaded page. Mirrors the same isCountryOutOfScope posture
    // shipment.service.ts uses: an out-of-scope explicit countryCode matches
    // nothing rather than silently widening; an unrestricted actor (ADMIN, or
    // no explicit UserCountryAccess rows) is untouched. `ignoreCountryFilter`
    // is set by countrySummary() alone: a facet count ignores its own filter
    // dimension so every country's count stays visible while one is selected,
    // the scope restriction still applies underneath it.
    const countryScope = await scopedCountryCodes(ctx);
    const explicitCountryCode = opts.ignoreCountryFilter ? undefined : filter.countryCode;
    if (countryScope) {
      and.push(
        explicitCountryCode
          ? { countryCode: countryScope.includes(explicitCountryCode) ? explicitCountryCode : { in: [] } }
          : { countryCode: { in: countryScope } },
      );
    } else if (explicitCountryCode) {
      and.push({ countryCode: explicitCountryCode });
    }
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

  // Enrich a page of influencer rows with their active-campaign counts/names
  // and total content count — three queries for the WHOLE page (never
  // per-row/N+1), shared by the offset and cursor list paths. Directory-card
  // quick context (item: "show campaign + video count on the outward card").
  async function toSummaries(
    rows: Prisma.InfluencerGetPayload<{ include: typeof summaryInclude }>[],
  ): Promise<InfluencerSummaryDTO[]> {
    const ids = rows.map((r) => r.id);
    const activeCounts = new Map<string, number>();
    const activeCampaignNames = new Map<string, string[]>();
    const contentCounts = new Map<string, number>();
    if (ids.length) {
      const [grouped, activeRoster, contentGrouped] = await Promise.all([
        prisma.campaignInfluencer.groupBy({
          by: ['influencerId'],
          where: { influencerId: { in: ids }, campaign: { status: 'ACTIVE' } },
          _count: { _all: true },
        }),
        prisma.campaignInfluencer.findMany({
          where: { influencerId: { in: ids }, campaign: { status: 'ACTIVE' } },
          select: { influencerId: true, campaign: { select: { name: true } } },
        }),
        prisma.publishedContent.groupBy({
          by: ['influencerId'],
          where: { influencerId: { in: ids } },
          _count: { _all: true },
        }),
      ]);
      for (const g of grouped) activeCounts.set(g.influencerId, g._count._all);
      for (const row of activeRoster) {
        const names = activeCampaignNames.get(row.influencerId) ?? [];
        names.push(row.campaign.name);
        activeCampaignNames.set(row.influencerId, names);
      }
      for (const g of contentGrouped) {
        if (g.influencerId) contentCounts.set(g.influencerId, g._count._all);
      }
    }
    return rows.map((r) =>
      toInfluencerSummary(r, {
        activeCampaigns: activeCounts.get(r.id) ?? 0,
        activeCampaignNames: activeCampaignNames.get(r.id) ?? [],
        contentCount: contentCounts.get(r.id) ?? 0,
      }),
    );
  }

  async function list(filter: InfluencerFilter): Promise<Paginated<InfluencerSummaryDTO>> {
    const where = await buildWhere(filter);
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

    return {
      data: await toSummaries(rows),
      pagination: buildOffsetPagination(filter.page, filter.pageSize, total),
    };
  }

  /**
   * Per-country creator counts for the directory's country-first summary
   * strip (item 80/81 of the Master Reconciliation pass) — "All Creators
   * 284, Kuwait 126, …", clicking a chip filters the SAME directory via
   * countryCode. Mirrors shipment.service.ts's summary(): one groupBy, never
   * N per-country round trips, and never a client-side count of a downloaded
   * page. Respects scope + every active filter except the country facet
   * itself (ignoreCountryFilter), so every country's count stays visible
   * while one is selected.
   */
  async function countrySummary(filter: InfluencerCountrySummaryQuery): Promise<InfluencerCountrySummaryDTO[]> {
    const where = await buildWhere(filter, { ignoreCountryFilter: true });
    const rows = await prisma.influencer.groupBy({ by: ['countryCode'], where, _count: { _all: true } });
    return rows
      .map((r) => ({
        countryCode: r.countryCode,
        countryName: countryName(r.countryCode),
        total: r._count._all,
      }))
      .sort((a, b) => b.total - a.total);
  }

  // Keyset (cursor) directory paging (W7-2). Orders by (createdAt desc, id desc)
  // — the id tiebreaker makes paging stable even when createdAt ties — and is
  // backed by the Influencer_createdAt_id index. No total count (unbounded feed).
  async function listCursor(filter: InfluencerCursorQuery): Promise<CursorPage<InfluencerSummaryDTO>> {
    const where = await buildWhere(filter);
    const rows = await prisma.influencer.findMany({
      where,
      include: summaryInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    return buildCursorPage(await toSummaries(rows), filter.limit);
  }

  // Flatten the directory (honoring its filters) into export rows — one scalar
  // record per influencer, with their contact + reach + tags — for CSV/JSON
  // download. Collections are pre-joined so every field is a single cell.
  async function exportRows(filter: InfluencerExportQuery): Promise<InfluencerExportRowDTO[]> {
    const where = await buildWhere(filter);
    const rows = await prisma.influencer.findMany({
      where,
      include: exportInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_MAX_ROWS,
    });
    return rows.map((r) => {
      // Reuse the summary mapper for reach/platform/tag derivation so an export
      // row's totals match exactly what the directory shows.
      const summary = toInfluencerSummary(r, {});
      return {
        id: r.id,
        displayName: r.displayName,
        fullName: r.fullName,
        primaryUsername: r.primaryUsername,
        primaryPlatform: r.primaryPlatform,
        category: r.category,
        country: r.country,
        city: r.city,
        relationshipStatus: r.relationshipStatus,
        priority: r.priority,
        audienceHealth: summary.audienceHealth,
        totalFollowers: summary.totalFollowers,
        platforms: summary.platforms.join('; '),
        email: r.email,
        mobile: r.mobile,
        whatsapp: r.whatsapp,
        managerName: r.managerName,
        managerContact: r.managerContact,
        preferredContact: r.preferredContact,
        languages: r.languages.join('; '),
        tags: summary.tags.join('; '),
        ownerName: r.owner?.name ?? null,
        isActive: r.isActive,
        createdAt: r.createdAt.toISOString(),
      };
    });
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

  /** Direct-ID brand scope (W4-4) — mirrors list()'s buildWhere `some: { brandId: { in: brandScope } }`
   *  exactly: an influencer with no link into the actor's brand scope (including one with no
   *  BrandInfluencer rows at all) is out of scope, not merely hidden from the filtered list. */
  async function isInfluencerBrandOutOfScope(influencerId: string): Promise<boolean> {
    const brandScope = await scopedBrandIds(ctx);
    if (!brandScope) return false;
    const match = await prisma.brandInfluencer.findFirst({
      where: { influencerId, brandId: { in: brandScope } },
      select: { id: true },
    });
    return !match;
  }

  async function detail(id: string): Promise<InfluencerDetailDTO> {
    const inf = await prisma.influencer.findUnique({
      where: { id },
      include: { ...summaryInclude, owner: { select: { id: true, name: true } } },
    });
    if (!inf) throw AppError.notFound('Influencer');
    // Direct-ID country scope (Advanced Roles pass) — a country-scoped actor
    // (e.g. a KW-only Influencer Manager) can never reach an out-of-scope
    // creator by guessing its id; not merely have it hidden in a filtered list.
    const countryScope = await scopedCountryCodes(ctx);
    if (isCountryOutOfScope(countryScope, inf.countryCode)) throw AppError.notFound('Influencer');
    if (await isInfluencerBrandOutOfScope(id)) throw AppError.notFound('Influencer');

    const [socialAccounts, audience, cis, contentCount] = await Promise.all([
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
              name: true,
              startDate: true,
              status: true,
              brand: { select: { id: true, name: true } },
            },
          },
          deliverables: { select: { status: true } },
        },
      }),
      prisma.publishedContent.count({ where: { influencerId: id } }),
    ]);

    // Relationship history (spec §56)
    const brandsMap = new Map<string, string>();
    let firstAt: Date | null = null;
    let lastAt: Date | null = null;
    let totalPaid = new Prisma.Decimal(0);
    const paidRates: Prisma.Decimal[] = [];
    let deliverablesTotal = 0;
    let deliverablesPublished = 0;
    let activeCampaigns = 0;
    const activeCampaignNames: string[] = [];

    for (const ci of cis) {
      brandsMap.set(ci.campaign.brand.id, ci.campaign.brand.name);
      const at = ci.campaign.startDate ?? ci.createdAt;
      if (!firstAt || at < firstAt) firstAt = at;
      if (!lastAt || at > lastAt) lastAt = at;
      if (ci.campaign.status === 'ACTIVE') {
        activeCampaigns += 1;
        activeCampaignNames.push(ci.campaign.name);
      }
      const cost = toDecimal(ci.agreedCost);
      if (cost != null && (ci.dealType === 'PAID' || ci.dealType === 'PAID_PLUS_GIFTED')) {
        paidRates.push(cost);
        if (ci.paymentStatus === 'PAID') totalPaid = totalPaid.plus(cost);
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
      { activeCampaigns, activeCampaignNames, contentCount },
    );

    return {
      ...summary,
      bio: inf.bio,
      city: inf.city,
      countryCode: inf.countryCode,
      addressLine1: inf.addressLine1,
      addressLine2: inf.addressLine2,
      postalCode: inf.postalCode,
      deliveryInstructions: inf.deliveryInstructions,
      languages: inf.languages,
      pricingNotes: inf.pricingNotes,
      internalNotes: inf.internalNotes,
      ownerId: inf.ownerId,
      ownerName: inf.owner?.name ?? null,
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
        totalPaid: paidRates.length ? totalPaid.toNumber() : null,
        // Exact Decimal sum ÷ count; averageRate is a whole-unit display figure.
        averageRate: paidRates.length
          ? Math.round(sumMoney(paidRates).dividedBy(paidRates.length).toNumber())
          : null,
        deliverablesPublished,
        deliverablesTotal,
      },
      createdAt: inf.createdAt.toISOString(),
    };
  }

  async function create(input: InfluencerCreate): Promise<InfluencerDetailDTO> {
    await requireCapability(ctx, 'INFLUENCERS_MANAGE');
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
        countryCode: input.countryCode ?? null,
        city: input.city ?? null,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        postalCode: input.postalCode ?? null,
        deliveryInstructions: input.deliveryInstructions ?? null,
        category: input.category ?? null,
        languages: input.languages ?? [],
        email,
        mobile: input.mobile ?? null,
        whatsapp: input.whatsapp ?? null,
        managerName: input.managerName ?? null,
        managerContact: input.managerContact ?? null,
        preferredContact: input.preferredContact ?? null,
        ownerId: input.ownerId ?? null,
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
    await requireCapability(ctx, 'INFLUENCERS_MANAGE');
    // A generic Influencer PATCH must not double as a back door around
    // logistics address policy (Security & Authorization Freeze Gate §16):
    // touching the creator's shipping-profile fields (see
    // INFLUENCER_SHIPPING_ADDRESS_FIELDS) additionally requires
    // LOGISTICS_ADDRESS_EDIT, the same capability that gates correcting those
    // fields via a shipment's own address in shipment.service.ts's update().
    // Every other field — name, category, tags, mobile, countryCode, owner,
    // relationship status, etc. — stays gated by INFLUENCERS_MANAGE alone.
    if (touchesShippingAddressFields(input)) {
      await requireCapability(ctx, 'LOGISTICS_ADDRESS_EDIT');
    }
    const existing = await prisma.influencer.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Influencer');
    const countryScope = await scopedCountryCodes(ctx);
    if (isCountryOutOfScope(countryScope, existing.countryCode)) throw AppError.notFound('Influencer');
    if (await isInfluencerBrandOutOfScope(id)) throw AppError.notFound('Influencer');
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
        countryCode: input.countryCode === undefined ? undefined : input.countryCode,
        city: input.city === undefined ? undefined : input.city,
        addressLine1: input.addressLine1 === undefined ? undefined : input.addressLine1,
        addressLine2: input.addressLine2 === undefined ? undefined : input.addressLine2,
        postalCode: input.postalCode === undefined ? undefined : input.postalCode,
        deliveryInstructions: input.deliveryInstructions === undefined ? undefined : input.deliveryInstructions,
        category: input.category === undefined ? undefined : input.category,
        languages: input.languages ?? undefined,
        email: email === undefined ? undefined : email,
        mobile: input.mobile === undefined ? undefined : input.mobile,
        whatsapp: input.whatsapp === undefined ? undefined : input.whatsapp,
        managerName: input.managerName === undefined ? undefined : input.managerName,
        managerContact: input.managerContact === undefined ? undefined : input.managerContact,
        preferredContact: input.preferredContact === undefined ? undefined : input.preferredContact,
        ownerId: input.ownerId === undefined ? undefined : input.ownerId,
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

  /**
   * Delete an influencer. Mirrors note.service.ts's remove() — the only other
   * conditional soft/hard delete in this codebase: a hard delete would
   * cascade through CampaignInfluencer into that roster participation's own
   * Deliverables, UGC submissions, shipments and logistics records (real
   * operational/financial history, not directory metadata), so a creator with
   * any campaign history is deactivated (isActive: false, the existing
   * directory-filterable flag) instead of removed. Only a creator with zero
   * campaign history — nothing to protect — is actually deleted.
   */
  async function remove(id: string): Promise<{ hardDeleted: boolean }> {
    await requireCapability(ctx, 'INFLUENCERS_MANAGE');
    const existing = await prisma.influencer.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Influencer');
    const countryScope = await scopedCountryCodes(ctx);
    if (isCountryOutOfScope(countryScope, existing.countryCode)) throw AppError.notFound('Influencer');
    if (await isInfluencerBrandOutOfScope(id)) throw AppError.notFound('Influencer');

    const campaignCount = await prisma.campaignInfluencer.count({ where: { influencerId: id } });
    if (campaignCount === 0) {
      await prisma.influencer.delete({ where: { id } });
      await logActivity(ctx, {
        type: 'GENERIC',
        message: `${ctx.actor?.name ?? 'Someone'} deleted ${existing.displayName} from the influencer directory.`,
      });
      return { hardDeleted: true };
    }

    await prisma.influencer.update({ where: { id }, data: { isActive: false } });
    await logActivity(ctx, {
      type: 'INFLUENCER_UPDATED',
      message: `${ctx.actor?.name ?? 'Someone'} deactivated ${existing.displayName} (campaign history preserved).`,
      influencerId: id,
    });
    return { hardDeleted: false };
  }

  /**
   * Re-resolve the creator's profile photo from their linked primary social
   * account and backfill `resolvedAvatarUrl` — for a creator who was added
   * without a successful "Find Creator" lookup (manual entry, import, or the
   * lookup found no photo at the time) and still shows the initials
   * placeholder. Never fabricates a photo: on failure it reports why via a
   * `reason` code (not a hardcoded English string) so the web client can
   * render it localized.
   */
  async function syncAvatar(
    id: string,
  ): Promise<{ influencer: InfluencerDetailDTO; synced: boolean; reason: 'NO_LINKED_ACCOUNT' | 'NOT_FOUND' | 'SYNCED' }> {
    await requireCapability(ctx, 'INFLUENCERS_MANAGE');
    const existing = await prisma.influencer.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Influencer');
    const countryScope = await scopedCountryCodes(ctx);
    if (isCountryOutOfScope(countryScope, existing.countryCode)) throw AppError.notFound('Influencer');
    if (await isInfluencerBrandOutOfScope(id)) throw AppError.notFound('Influencer');

    if (!existing.primaryPlatform || !existing.primaryUsername) {
      return { influencer: await detail(id), synced: false, reason: 'NO_LINKED_ACCOUNT' };
    }

    const avatarUrl = await resolveAvatarUrl(existing.primaryPlatform, existing.primaryUsername, ctx.credentials);
    if (!avatarUrl) {
      return { influencer: await detail(id), synced: false, reason: 'NOT_FOUND' };
    }

    await prisma.influencer.update({ where: { id }, data: { resolvedAvatarUrl: avatarUrl } });

    // Keep the linked primary social account's own avatar in step, if one exists.
    const primaryAccount = await prisma.socialAccount.findUnique({
      where: { platform_username: { platform: existing.primaryPlatform, username: existing.primaryUsername } },
      select: { id: true, influencerId: true },
    });
    if (primaryAccount && primaryAccount.influencerId === id) {
      await prisma.socialAccount.update({ where: { id: primaryAccount.id }, data: { avatarUrl, lastSyncedAt: new Date() } });
    }

    await logActivity(ctx, {
      type: 'INFLUENCER_UPDATED',
      message: `${ctx.actor?.name ?? 'Someone'} synced ${existing.displayName}'s profile photo from ${existing.primaryPlatform}.`,
      influencerId: id,
    });

    return { influencer: await detail(id), synced: true, reason: 'SYNCED' };
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

  /** Per-account follower time series for the 360 profile growth charts. */
  async function followerSeries(influencerId: string): Promise<
    {
      accountId: string;
      platform: Platform;
      username: string;
      points: { capturedAt: string; followers: number | null }[];
    }[]
  > {
    const accounts = await prisma.socialAccount.findMany({
      where: { influencerId },
      orderBy: [{ isPrimary: 'desc' }, { followers: 'desc' }],
      select: { id: true, platform: true, username: true },
    });
    return Promise.all(
      accounts.map(async (a) => {
        const snaps = await prisma.socialMetricSnapshot.findMany({
          where: { socialAccountId: a.id },
          orderBy: { capturedAt: 'asc' },
          take: 365,
          select: { capturedAt: true, followers: true },
        });
        return {
          accountId: a.id,
          platform: a.platform,
          username: a.username,
          points: snaps.map((s) => ({ capturedAt: s.capturedAt.toISOString(), followers: s.followers })),
        };
      }),
    );
  }

  return { list, listCursor, countrySummary, exportRows, detail, create, update, remove, syncAvatar, socialAccountsFor, audienceFor, followerSeries };
}

export type InfluencerService = ReturnType<typeof makeInfluencerService>;
