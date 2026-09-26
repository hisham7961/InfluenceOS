import type { AttachmentKind, AudienceInsightDTO, requests, z } from '@influenceos/contracts';
import type { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireCapability } from '../lib/authz';
import { logActivity } from '../lib/helpers';
import { isCountryOutOfScope, scopedBrandIds, scopedCountryCodes } from '../lib/scope';

type InsightCreate = z.infer<typeof requests.audienceInsightCreateSchema>;
type InsightUpdate = z.infer<typeof requests.audienceInsightUpdateSchema>;

const insightInclude = {
  socialAccount: { select: { id: true, platform: true, username: true, influencerId: true } },
  countries: { select: { countryCode: true, pct: true }, orderBy: { pct: 'desc' } },
  attachment: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, kind: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.AudienceInsightInclude;
type Row = Prisma.AudienceInsightGetPayload<{ include: typeof insightInclude }>;

function toDTO(r: Row): AudienceInsightDTO {
  return {
    id: r.id,
    socialAccountId: r.socialAccountId,
    platform: r.socialAccount.platform,
    username: r.socialAccount.username,
    capturedAt: r.capturedAt.toISOString(),
    source: r.source,
    isLatest: r.isLatest,
    countries: r.countries.map((c) => ({ countryCode: c.countryCode, pct: c.pct })),
    femalePct: r.femalePct,
    malePct: r.malePct,
    ages: {
      age13to17Pct: r.age13to17Pct,
      age18to24Pct: r.age18to24Pct,
      age25to34Pct: r.age25to34Pct,
      age35to44Pct: r.age35to44Pct,
      age45PlusPct: r.age45PlusPct,
    },
    engagementRate: r.engagementRate,
    document: r.attachment
      ? {
          id: r.attachment.id,
          fileName: r.attachment.fileName,
          mimeType: r.attachment.mimeType,
          sizeBytes: r.attachment.sizeBytes,
          kind: (r.attachment.kind ?? 'other') as AttachmentKind,
        }
      : null,
    notes: r.notes,
    createdByName: r.createdBy?.name ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Audience insights (P3.7): who follows each of a creator's accounts — top
 * countries, women/men, age groups — as the team types it from the
 * creator's insights screenshot. The newest breakdown per account is the one
 * the directory filters on ("audience in Kuwait ≥ 40%").
 */
export function makeAudienceService(ctx: DomainContext) {
  const { prisma } = ctx;

  /** Same direct-ID rule as the creator's own page: country scope, then brand scope. */
  async function influencerInScope(influencerId: string) {
    const inf = await prisma.influencer.findUnique({
      where: { id: influencerId },
      select: { id: true, displayName: true, countryCode: true },
    });
    if (!inf || isCountryOutOfScope(await scopedCountryCodes(ctx), inf.countryCode)) {
      throw AppError.notFound('Influencer');
    }
    const brandScope = await scopedBrandIds(ctx);
    if (brandScope) {
      const link = await prisma.brandInfluencer.findFirst({
        where: { influencerId, brandId: { in: brandScope } },
        select: { id: true },
      });
      if (!link) throw AppError.notFound('Influencer');
    }
    return inf;
  }

  async function accountInScope(socialAccountId: string) {
    const account = await prisma.socialAccount.findUnique({
      where: { id: socialAccountId },
      select: { id: true, platform: true, username: true, influencerId: true },
    });
    if (!account) throw AppError.notFound('Social account');
    try {
      return { account, inf: await influencerInScope(account.influencerId) };
    } catch {
      throw AppError.notFound('Social account');
    }
  }

  /** The screenshot must be one of this creator's own files. */
  async function assertOwnFile(influencerId: string, attachmentId: string | null | undefined) {
    if (!attachmentId) return;
    const file = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { influencerId: true },
    });
    if (!file || file.influencerId !== influencerId) {
      throw AppError.badRequest("The screenshot must be one of this creator's files.");
    }
  }

  /**
   * Mark the account's newest breakdown as its latest, and keep the account's
   * engagement rate in step with it when that breakdown has one.
   */
  async function refreshLatest(tx: Prisma.TransactionClient, socialAccountId: string) {
    const newest = await tx.audienceInsight.findFirst({
      where: { socialAccountId },
      orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, engagementRate: true },
    });
    await tx.audienceInsight.updateMany({
      where: { socialAccountId, isLatest: true, ...(newest ? { id: { not: newest.id } } : {}) },
      data: { isLatest: false },
    });
    if (!newest) return;
    await tx.audienceInsight.update({ where: { id: newest.id }, data: { isLatest: true } });
    if (newest.engagementRate != null) {
      await tx.socialAccount.update({
        where: { id: socialAccountId },
        data: { engagementRate: newest.engagementRate },
      });
    }
  }

  async function listForInfluencer(influencerId: string): Promise<AudienceInsightDTO[]> {
    await requireCapability(ctx, 'INFLUENCERS_VIEW');
    await influencerInScope(influencerId);
    const rows = await prisma.audienceInsight.findMany({
      where: { socialAccount: { influencerId } },
      include: insightInclude,
      orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return rows.map(toDTO);
  }

  async function create(
    socialAccountId: string,
    input: InsightCreate,
  ): Promise<AudienceInsightDTO> {
    const actor = await requireCapability(ctx, 'INFLUENCERS_MANAGE');
    const { account, inf } = await accountInScope(socialAccountId);
    await assertOwnFile(account.influencerId, input.attachmentId);
    const id = await prisma.$transaction(async (tx) => {
      const created = await tx.audienceInsight.create({
        data: {
          socialAccountId,
          capturedAt: input.capturedAt,
          source: input.source,
          femalePct: input.femalePct ?? null,
          malePct: input.malePct ?? null,
          age13to17Pct: input.age13to17Pct ?? null,
          age18to24Pct: input.age18to24Pct ?? null,
          age25to34Pct: input.age25to34Pct ?? null,
          age35to44Pct: input.age35to44Pct ?? null,
          age45PlusPct: input.age45PlusPct ?? null,
          engagementRate: input.engagementRate ?? null,
          attachmentId: input.attachmentId ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
          countries: {
            create: input.countries.map((c) => ({ countryCode: c.countryCode, pct: c.pct })),
          },
        },
        select: { id: true },
      });
      await refreshLatest(tx, socialAccountId);
      await logActivity(
        ctx,
        {
          type: 'INFLUENCER_UPDATED',
          message: `${actor.name} added audience insights for ${inf.displayName} (@${account.username}).`,
          influencerId: inf.id,
          meta: { audienceInsightId: created.id, socialAccountId },
        },
        tx,
      );
      return created.id;
    });
    return toDTO(
      await prisma.audienceInsight.findUniqueOrThrow({ where: { id }, include: insightInclude }),
    );
  }

  async function findInScope(id: string) {
    const existing = await prisma.audienceInsight.findUnique({
      where: { id },
      select: { id: true, socialAccountId: true },
    });
    if (!existing) throw AppError.notFound('Audience insights');
    try {
      return { existing, ...(await accountInScope(existing.socialAccountId)) };
    } catch {
      throw AppError.notFound('Audience insights');
    }
  }

  async function update(id: string, input: InsightUpdate): Promise<AudienceInsightDTO> {
    const actor = await requireCapability(ctx, 'INFLUENCERS_MANAGE');
    const { existing, account, inf } = await findInScope(id);
    await assertOwnFile(account.influencerId, input.attachmentId);
    const keep = <T>(v: T | undefined) => (v === undefined ? undefined : v);
    await prisma.$transaction(async (tx) => {
      await tx.audienceInsight.update({
        where: { id },
        data: {
          capturedAt: keep(input.capturedAt),
          source: keep(input.source),
          femalePct: keep(input.femalePct),
          malePct: keep(input.malePct),
          age13to17Pct: keep(input.age13to17Pct),
          age18to24Pct: keep(input.age18to24Pct),
          age25to34Pct: keep(input.age25to34Pct),
          age35to44Pct: keep(input.age35to44Pct),
          age45PlusPct: keep(input.age45PlusPct),
          engagementRate: keep(input.engagementRate),
          attachmentId: keep(input.attachmentId),
          notes: keep(input.notes),
          ...(input.countries
            ? {
                countries: {
                  deleteMany: {},
                  create: input.countries.map((c) => ({ countryCode: c.countryCode, pct: c.pct })),
                },
              }
            : {}),
        },
      });
      await refreshLatest(tx, existing.socialAccountId);
      await logActivity(
        ctx,
        {
          type: 'INFLUENCER_UPDATED',
          message: `${actor.name} updated audience insights for ${inf.displayName} (@${account.username}).`,
          influencerId: inf.id,
          meta: { audienceInsightId: id, socialAccountId: existing.socialAccountId },
        },
        tx,
      );
    });
    return toDTO(
      await prisma.audienceInsight.findUniqueOrThrow({ where: { id }, include: insightInclude }),
    );
  }

  async function remove(id: string): Promise<void> {
    const actor = await requireCapability(ctx, 'INFLUENCERS_MANAGE');
    const { existing, account, inf } = await findInScope(id);
    await prisma.$transaction(async (tx) => {
      await tx.audienceInsight.delete({ where: { id } });
      await refreshLatest(tx, existing.socialAccountId);
      await logActivity(
        ctx,
        {
          type: 'INFLUENCER_UPDATED',
          message: `${actor.name} removed audience insights for ${inf.displayName} (@${account.username}).`,
          influencerId: inf.id,
          meta: { audienceInsightId: id, socialAccountId: existing.socialAccountId },
        },
        tx,
      );
    });
  }

  return { listForInfluencer, create, update, remove };
}

export type AudienceService = ReturnType<typeof makeAudienceService>;
