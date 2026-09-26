import { hasArabic } from '@influenceos/shared';
import { Prisma, type PrismaClient } from '@influenceos/database';

/**
 * Arabic-aware text search. `contains` matches letter for letter, so "احمد"
 * misses "أحمد" and "فاطمه" misses "فاطمة". When the search has Arabic
 * letters, these find the rows whose text matches with the spelling variants
 * folded (the database's ar_fold(), the same rule as foldArabic()), and the
 * callers OR the ids into their usual `contains` conditions — scope, filters
 * and paging stay exactly as they were.
 */

/** Enough for any page of results; a search this broad is refined anyway. */
const MAX_IDS = 1000;

export type ArabicSearchTarget =
  | 'influencer'
  | 'influencerWithTagsNotes'
  | 'campaign'
  | 'campaignWithDescription'
  | 'brand'
  | 'brandWithNotes'
  | 'content'
  | 'inspiration';

function likePattern(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function query(target: ArabicSearchTarget, p: string): Prisma.Sql {
  const like = (col: Prisma.Sql) => Prisma.sql`ar_fold(${col}) LIKE ar_fold(${p})`;
  switch (target) {
    case 'influencer':
    case 'influencerWithTagsNotes': {
      const extra =
        target === 'influencerWithTagsNotes'
          ? Prisma.sql` OR EXISTS (SELECT 1 FROM "InfluencerTag" it JOIN "Tag" t ON t.id = it."tagId"
                          WHERE it."influencerId" = i.id AND ${like(Prisma.sql`t.name`)})
                        OR EXISTS (SELECT 1 FROM "Note" n
                          WHERE n."influencerId" = i.id AND n."deletedAt" IS NULL AND ${like(Prisma.sql`n.body`)})`
          : Prisma.empty;
      return Prisma.sql`SELECT i.id FROM "Influencer" i
        WHERE ${like(Prisma.sql`i."displayName"`)} OR ${like(Prisma.sql`i."fullName"`)}${extra}
        LIMIT ${MAX_IDS}`;
    }
    case 'campaign':
    case 'campaignWithDescription': {
      const extra =
        target === 'campaignWithDescription'
          ? Prisma.sql` OR ${like(Prisma.sql`c.description`)}`
          : Prisma.empty;
      return Prisma.sql`SELECT c.id FROM "Campaign" c
        WHERE ${like(Prisma.sql`c.name`)}${extra} LIMIT ${MAX_IDS}`;
    }
    case 'brand':
    case 'brandWithNotes': {
      const extra =
        target === 'brandWithNotes'
          ? Prisma.sql` OR EXISTS (SELECT 1 FROM "Note" n
              WHERE n."brandId" = b.id AND n."deletedAt" IS NULL AND ${like(Prisma.sql`n.body`)})`
          : Prisma.empty;
      return Prisma.sql`SELECT b.id FROM "Brand" b
        WHERE ${like(Prisma.sql`b.name`)}${extra} LIMIT ${MAX_IDS}`;
    }
    case 'content':
      return Prisma.sql`SELECT pc.id FROM "PublishedContent" pc
        WHERE ${like(Prisma.sql`pc.caption`)} LIMIT ${MAX_IDS}`;
    case 'inspiration':
      return Prisma.sql`SELECT ii.id FROM "InspirationItem" ii
        WHERE ${like(Prisma.sql`ii.title`)} OR ${like(Prisma.sql`ii.note`)} LIMIT ${MAX_IDS}`;
  }
}

/**
 * Ids of `target` rows whose text matches `q` with Arabic spelling variants
 * folded — `null` when `q` has no Arabic (nothing to fold, so callers skip
 * the extra condition).
 */
export async function arabicMatchIds(
  prisma: PrismaClient | Prisma.TransactionClient,
  target: ArabicSearchTarget,
  q: string | null | undefined,
): Promise<string[] | null> {
  if (!q || !q.trim() || !hasArabic(q)) return null;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(query(target, likePattern(q)));
  return rows.map((r) => r.id);
}

/** The extra `{ id: { in } }` condition for an OR list — none when there's nothing to add. */
export function orIds(ids: string[] | null): Array<{ id: { in: string[] } }> {
  return ids && ids.length ? [{ id: { in: ids } }] : [];
}
