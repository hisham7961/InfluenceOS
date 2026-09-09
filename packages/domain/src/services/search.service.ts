import { requests, type SearchResultDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { DomainContext } from '../context';

type SearchInput = z.infer<typeof requests.searchSchema>;

/**
 * Backend global search (addendum §27). Fans out across the four searchable
 * entity types in parallel and returns a single flat, unpaginated list of
 * lightweight results for a command-palette-style UI.
 */
export function makeSearchService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function search(input: SearchInput): Promise<SearchResultDTO[]> {
    const { q, limit, brandId } = input;

    const [influencers, campaigns, brands, content] = await Promise.all([
      prisma.influencer.findMany({
        where: {
          OR: [
            { displayName: { contains: q, mode: 'insensitive' } },
            { primaryUsername: { contains: q, mode: 'insensitive' } },
            { socialAccounts: { some: { username: { contains: q, mode: 'insensitive' } } } },
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
          ...(brandId ? { brandId } : {}),
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
        where: { name: { contains: q, mode: 'insensitive' } },
        select: { id: true, name: true, slug: true, logoUrl: true },
        take: limit,
      }),
      prisma.publishedContent.findMany({
        where: {
          OR: [
            { caption: { contains: q, mode: 'insensitive' } },
            { originalUrl: { contains: q, mode: 'insensitive' } },
          ],
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

  return { search };
}

export type SearchService = ReturnType<typeof makeSearchService>;
