import {
  requests,
  type RankedSearchResultDTO,
  type SearchPageDTO,
  type SearchResultDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { bestScore } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { scopedBrandIds, scopedCountryCodes } from '../lib/scope';

type SearchInput = z.infer<typeof requests.searchSchema>;
type SearchPageInput = z.infer<typeof requests.searchPageSchema>;

// How many candidates to pull per entity type before ranking + paginating.
const CANDIDATE_CAP = 60;

/**
 * Backend global search (addendum §27). Fans out across the four searchable
 * entity types in parallel and returns a single flat, unpaginated list of
 * lightweight results for a command-palette-style UI.
 */
export function makeSearchService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function search(input: SearchInput): Promise<SearchResultDTO[]> {
    const { q, limit, brandId } = input;

    // Brand + country scope (Security & Authorization Freeze Gate,
    // aggregate-leak-audit) — composed server-side into EVERY entity type's
    // query, never a client-side post-filter of a downloaded page. Mirrors
    // campaign.service.ts's buildWhere()/influencer.service.ts's buildWhere()
    // posture exactly: an out-of-scope explicit brandId matches nothing
    // rather than silently widening; an unscoped actor (ADMIN, or no
    // explicit UserBrandAccess/UserCountryAccess rows) is untouched. Without
    // this, search/autocomplete would leak an out-of-scope entity's
    // name/username/phone/campaign through its result snippet even though
    // the entity itself is unreachable everywhere else in the app.
    const brandScope = await scopedBrandIds(ctx);
    const countryScope = await scopedCountryCodes(ctx);
    const scopedBrandIdFilter = brandId
      ? brandScope && !brandScope.includes(brandId)
        ? { in: [] }
        : brandId
      : brandScope
        ? { in: brandScope }
        : undefined;

    const [influencers, campaigns, brands, content] = await Promise.all([
      prisma.influencer.findMany({
        where: {
          AND: [
            {
              OR: [
                { displayName: { contains: q, mode: 'insensitive' } },
                { primaryUsername: { contains: q, mode: 'insensitive' } },
                { socialAccounts: { some: { username: { contains: q, mode: 'insensitive' } } } },
              ],
            },
            ...(brandScope ? [{ brandInfluencers: { some: { brandId: { in: brandScope } } } }] : []),
            ...(countryScope ? [{ countryCode: { in: countryScope } }] : []),
          ],
        },
        select: {
          id: true,
          displayName: true,
          primaryUsername: true,
          category: true,
          avatarOverrideUrl: true,
          resolvedAvatarUrl: true,
        },
        take: limit,
      }),
      prisma.campaign.findMany({
        where: {
          name: { contains: q, mode: 'insensitive' },
          ...(scopedBrandIdFilter !== undefined ? { brandId: scopedBrandIdFilter } : {}),
        },
        select: {
          id: true,
          name: true,
          coverUrl: true,
          brand: { select: { name: true } },
        },
        take: limit,
      }),
      prisma.brand.findMany({
        where: {
          name: { contains: q, mode: 'insensitive' },
          ...(brandScope ? { id: { in: brandScope } } : {}),
        },
        select: { id: true, name: true, slug: true, logoUrl: true },
        take: limit,
      }),
      prisma.publishedContent.findMany({
        where: {
          OR: [
            { caption: { contains: q, mode: 'insensitive' } },
            { originalUrl: { contains: q, mode: 'insensitive' } },
          ],
          ...(brandScope ? { brandId: { in: brandScope } } : {}),
        },
        select: {
          id: true,
          platform: true,
          caption: true,
          thumbnailUrl: true,
          influencer: { select: { displayName: true } },
          campaign: { select: { name: true } },
        },
        take: limit,
      }),
    ]);

    const influencerResults: SearchResultDTO[] = influencers.map((inf) => ({
      type: 'influencer',
      id: inf.id,
      title: inf.displayName,
      subtitle: inf.primaryUsername ? `@${inf.primaryUsername}` : (inf.category ?? null),
      imageUrl: inf.avatarOverrideUrl ?? inf.resolvedAvatarUrl ?? null,
      link: `/influencers/${inf.id}`,
    }));

    const campaignResults: SearchResultDTO[] = campaigns.map((c) => ({
      type: 'campaign',
      id: c.id,
      title: c.name,
      subtitle: c.brand.name,
      imageUrl: c.coverUrl,
      link: `/campaigns/${c.id}`,
    }));

    const brandResults: SearchResultDTO[] = brands.map((b) => ({
      type: 'brand',
      id: b.id,
      title: b.name,
      subtitle: b.slug,
      imageUrl: b.logoUrl,
      link: `/brands/${b.slug}`,
    }));

    const contentResults: SearchResultDTO[] = content.map((pc) => ({
      type: 'published_content',
      id: pc.id,
      title: pc.caption ? pc.caption.slice(0, 60) : `${pc.platform} content`,
      subtitle: pc.influencer?.displayName ?? null,
      imageUrl: pc.thumbnailUrl,
      link: `/content/${pc.id}`,
    }));

    return [...influencerResults, ...campaignResults, ...brandResults, ...contentResults];
  }

  /**
   * Full, ranked, paginated global search (W3-6). Beyond the command-palette
   * `search`, this also indexes influencer tags + notes and brand notes, scores
   * every candidate by how well (and where) it matched, sorts by relevance, and
   * returns one page with the true total.
   */
  async function searchPage(input: SearchPageInput): Promise<SearchPageDTO> {
    const { q, brandId, page, pageSize } = input;
    const types = new Set(input.types && input.types.length > 0 ? input.types : requests.SEARCH_RESULT_TYPES);
    const contains = { contains: q, mode: 'insensitive' as const };

    // Brand + country scope — same posture as search() above, composed into
    // every candidate query here too (this is a SEPARATE query path, not a
    // wrapper around search(), so it must independently enforce scope rather
    // than inherit it).
    const brandScope = await scopedBrandIds(ctx);
    const countryScope = await scopedCountryCodes(ctx);
    const scopedBrandIdFilter = brandId
      ? brandScope && !brandScope.includes(brandId)
        ? { in: [] }
        : brandId
      : brandScope
        ? { in: brandScope }
        : undefined;

    const [influencers, campaigns, brands, content] = await Promise.all([
      types.has('influencer')
        ? prisma.influencer.findMany({
            where: {
              AND: [
                {
                  OR: [
                    { displayName: contains },
                    { fullName: contains },
                    { primaryUsername: contains },
                    { socialAccounts: { some: { username: contains } } },
                    { tags: { some: { tag: { name: contains } } } },
                    { notes: { some: { body: contains } } },
                  ],
                },
                ...(brandScope ? [{ brandInfluencers: { some: { brandId: { in: brandScope } } } }] : []),
                ...(countryScope ? [{ countryCode: { in: countryScope } }] : []),
              ],
            },
            select: {
              id: true,
              displayName: true,
              fullName: true,
              primaryUsername: true,
              category: true,
              avatarOverrideUrl: true,
              resolvedAvatarUrl: true,
              socialAccounts: { select: { username: true } },
              tags: { select: { tag: { select: { name: true } } } },
              notes: { select: { body: true }, take: 10 },
            },
            take: CANDIDATE_CAP,
          })
        : [],
      types.has('campaign')
        ? prisma.campaign.findMany({
            where: {
              AND: [
                { OR: [{ name: contains }, { description: contains }] },
                ...(scopedBrandIdFilter !== undefined ? [{ brandId: scopedBrandIdFilter }] : []),
              ],
            },
            select: { id: true, name: true, description: true, coverUrl: true, brand: { select: { name: true } } },
            take: CANDIDATE_CAP,
          })
        : [],
      types.has('brand')
        ? prisma.brand.findMany({
            where: {
              AND: [
                { OR: [{ name: contains }, { notes: { some: { body: contains } } }] },
                ...(brandScope ? [{ id: { in: brandScope } }] : []),
              ],
            },
            select: { id: true, name: true, slug: true, logoUrl: true, notes: { select: { body: true }, take: 10 } },
            take: CANDIDATE_CAP,
          })
        : [],
      types.has('published_content')
        ? prisma.publishedContent.findMany({
            where: {
              OR: [{ caption: contains }, { originalUrl: contains }],
              ...(brandScope ? { brandId: { in: brandScope } } : {}),
            },
            select: {
              id: true,
              platform: true,
              caption: true,
              originalUrl: true,
              thumbnailUrl: true,
              influencer: { select: { displayName: true } },
            },
            take: CANDIDATE_CAP,
          })
        : [],
    ]);

    const ranked: RankedSearchResultDTO[] = [];

    for (const inf of influencers) {
      const usernames = inf.socialAccounts.map((s) => s.username);
      const tagNames = inf.tags.map((t) => t.tag.name);
      const noteBodies = inf.notes.map((n) => n.body);
      const scores: Array<[string, number]> = [
        ['name', bestScore([inf.displayName, inf.fullName], q)],
        ['username', bestScore([inf.primaryUsername, ...usernames], q)],
        ['tag', bestScore(tagNames, q) * 0.6],
        ['note', bestScore(noteBodies, q) * 0.4],
      ];
      const [matchedOn, score] = pickBest(scores);
      ranked.push({
        type: 'influencer',
        id: inf.id,
        title: inf.displayName,
        subtitle: inf.primaryUsername ? `@${inf.primaryUsername}` : (inf.category ?? null),
        imageUrl: inf.avatarOverrideUrl ?? inf.resolvedAvatarUrl ?? null,
        link: `/influencers/${inf.id}`,
        score,
        matchedOn,
      });
    }

    for (const c of campaigns) {
      const scores: Array<[string, number]> = [
        ['name', bestScore([c.name], q)],
        ['note', bestScore([c.description], q) * 0.5],
      ];
      const [matchedOn, score] = pickBest(scores);
      ranked.push({ type: 'campaign', id: c.id, title: c.name, subtitle: c.brand.name, imageUrl: c.coverUrl, link: `/campaigns/${c.id}`, score, matchedOn });
    }

    for (const b of brands) {
      const scores: Array<[string, number]> = [
        ['name', bestScore([b.name], q)],
        ['note', bestScore(b.notes.map((n) => n.body), q) * 0.4],
      ];
      const [matchedOn, score] = pickBest(scores);
      ranked.push({ type: 'brand', id: b.id, title: b.name, subtitle: b.slug, imageUrl: b.logoUrl, link: `/brands/${b.slug}`, score, matchedOn });
    }

    for (const pc of content) {
      const scores: Array<[string, number]> = [
        ['caption', bestScore([pc.caption], q)],
        ['url', bestScore([pc.originalUrl], q) * 0.5],
      ];
      const [matchedOn, score] = pickBest(scores);
      ranked.push({
        type: 'published_content',
        id: pc.id,
        title: pc.caption ? pc.caption.slice(0, 60) : `${pc.platform} content`,
        subtitle: pc.influencer?.displayName ?? null,
        imageUrl: pc.thumbnailUrl,
        link: `/content/${pc.id}`,
        score,
        matchedOn,
      });
    }

    // Highest relevance first; ties broken by title for a stable order.
    ranked.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    const total = ranked.length;
    const start = (page - 1) * pageSize;
    return { results: ranked.slice(start, start + pageSize), total, page, pageSize };
  }

  return { search, searchPage };
}

/** Pick the highest-scoring [field, score] pair; defaults to a floor of 10. */
function pickBest(scores: Array<[string, number]>): [string, number] {
  let bestField = 'name';
  let best = 0;
  for (const [field, score] of scores) {
    if (score > best) {
      best = score;
      bestField = field;
    }
  }
  // Every candidate matched the DB query, so guarantee a non-zero floor.
  return [bestField, best > 0 ? Math.round(best) : 10];
}

export type SearchService = ReturnType<typeof makeSearchService>;
