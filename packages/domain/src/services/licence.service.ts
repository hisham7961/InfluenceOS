import type {
  AttachmentKind,
  CampaignLicenceCheckDTO,
  ComplianceSettingsDTO,
  CreatorLicenceDTO,
  requests,
  z,
} from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireAdmin, requireCapability } from '../lib/authz';
import { iso, logActivity } from '../lib/helpers';
import {
  LICENCE_ALERT_STATUSES,
  LICENCE_CAMPAIGN_STATUSES,
  LICENCE_CHECKED_STATUSES,
  checkCreator,
  countriesToCheck,
  licenceStatus,
} from '../lib/licences';
import {
  isBrandOutOfScope,
  isCountryOutOfScope,
  scopedBrandIds,
  scopedCountryCodes,
} from '../lib/scope';

type LicenceCreate = z.infer<typeof requests.creatorLicenceCreateSchema>;
type LicenceUpdate = z.infer<typeof requests.creatorLicenceUpdateSchema>;
type SettingsUpdate = z.infer<typeof requests.complianceSettingsUpdateSchema>;

/** Used until an admin saves their own list. Matches the column default. */
export const DEFAULT_LICENCE_COUNTRIES = ['KW', 'SA', 'AE'];

const licenceInclude = {
  attachment: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, kind: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.CreatorLicenceInclude;
type Row = Prisma.CreatorLicenceGetPayload<{ include: typeof licenceInclude }>;

function toDTO(r: Row, now = new Date()): CreatorLicenceDTO {
  const { status, daysLeft } = licenceStatus(r.expiresAt, now);
  return {
    id: r.id,
    influencerId: r.influencerId,
    countryCode: r.countryCode,
    authority: r.authority,
    number: r.number,
    issuedAt: iso(r.issuedAt),
    expiresAt: iso(r.expiresAt),
    status,
    daysLeft,
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
 * Creator advertising licences (P3.5): the licence records on a creator,
 * the check of a campaign's roster against the campaign's countries, and the
 * admin setting for which countries need a licence at all.
 */
export function makeLicenceService(ctx: DomainContext) {
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

  /** The scanned licence must be one of this creator's own files. */
  async function assertOwnFile(influencerId: string, attachmentId: string | null | undefined) {
    if (!attachmentId) return;
    const file = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { influencerId: true },
    });
    if (!file || file.influencerId !== influencerId) {
      throw AppError.badRequest("The licence file must be one of this creator's files.");
    }
  }

  async function requiredCountries(): Promise<string[]> {
    const row = await prisma.clientConfig.findFirst({ select: { licenceCountryCodes: true } });
    return row?.licenceCountryCodes ?? DEFAULT_LICENCE_COUNTRIES;
  }

  async function listForInfluencer(influencerId: string): Promise<CreatorLicenceDTO[]> {
    await requireCapability(ctx, 'INFLUENCERS_VIEW');
    await influencerInScope(influencerId);
    const rows = await prisma.creatorLicence.findMany({
      where: { influencerId },
      include: licenceInclude,
      orderBy: [{ countryCode: 'asc' }],
    });
    const now = new Date();
    return rows.map((r) => toDTO(r, now));
  }

  async function create(influencerId: string, input: LicenceCreate): Promise<CreatorLicenceDTO> {
    const actor = await requireCapability(ctx, 'INFLUENCERS_MANAGE');
    const inf = await influencerInScope(influencerId);
    await assertOwnFile(influencerId, input.attachmentId);
    const clash = await prisma.creatorLicence.findUnique({
      where: { influencerId_countryCode: { influencerId, countryCode: input.countryCode } },
      select: { id: true },
    });
    if (clash)
      throw AppError.conflict(
        'This creator already has a licence for that country. Edit it instead.',
      );
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.creatorLicence.create({
        data: {
          influencerId,
          countryCode: input.countryCode,
          authority: input.authority ?? null,
          number: input.number ?? null,
          issuedAt: input.issuedAt ?? null,
          expiresAt: input.expiresAt ?? null,
          attachmentId: input.attachmentId ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
        },
        include: licenceInclude,
      });
      await logActivity(
        ctx,
        {
          type: 'INFLUENCER_UPDATED',
          message: `${actor.name} recorded ${inf.displayName}'s advertising licence for ${input.countryCode}.`,
          influencerId,
          meta: { licenceId: created.id, countryCode: input.countryCode },
        },
        tx,
      );
      return created;
    });
    return toDTO(row);
  }

  async function findInScope(id: string) {
    const existing = await prisma.creatorLicence.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Licence');
    try {
      return { existing, inf: await influencerInScope(existing.influencerId) };
    } catch {
      throw AppError.notFound('Licence');
    }
  }

  async function update(id: string, input: LicenceUpdate): Promise<CreatorLicenceDTO> {
    const actor = await requireCapability(ctx, 'INFLUENCERS_MANAGE');
    const { existing, inf } = await findInScope(id);
    await assertOwnFile(existing.influencerId, input.attachmentId);
    const issuedAt = input.issuedAt === undefined ? existing.issuedAt : input.issuedAt;
    const expiresAt = input.expiresAt === undefined ? existing.expiresAt : input.expiresAt;
    if (issuedAt && expiresAt && expiresAt < issuedAt) {
      throw AppError.badRequest('The expiry date must be after the issue date.');
    }
    if (input.countryCode && input.countryCode !== existing.countryCode) {
      const clash = await prisma.creatorLicence.findUnique({
        where: {
          influencerId_countryCode: {
            influencerId: existing.influencerId,
            countryCode: input.countryCode,
          },
        },
        select: { id: true },
      });
      if (clash)
        throw AppError.conflict(
          'This creator already has a licence for that country. Edit it instead.',
        );
    }
    const expiryChanged =
      input.expiresAt !== undefined && iso(input.expiresAt) !== iso(existing.expiresAt);
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.creatorLicence.update({
        where: { id },
        data: {
          countryCode: input.countryCode ?? undefined,
          authority: input.authority === undefined ? undefined : input.authority,
          number: input.number === undefined ? undefined : input.number,
          issuedAt: input.issuedAt === undefined ? undefined : input.issuedAt,
          expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt,
          attachmentId: input.attachmentId === undefined ? undefined : input.attachmentId,
          notes: input.notes === undefined ? undefined : input.notes,
          // A renewed licence gets its own "about to expire" warning later.
          ...(expiryChanged ? { expiryRemindedAt: null } : {}),
        },
        include: licenceInclude,
      });
      await logActivity(
        ctx,
        {
          type: 'INFLUENCER_UPDATED',
          message: `${actor.name} updated ${inf.displayName}'s advertising licence for ${updated.countryCode}.`,
          influencerId: existing.influencerId,
          meta: { licenceId: id, countryCode: updated.countryCode },
        },
        tx,
      );
      return updated;
    });
    return toDTO(row);
  }

  async function remove(id: string): Promise<void> {
    const actor = await requireCapability(ctx, 'INFLUENCERS_MANAGE');
    const { existing, inf } = await findInScope(id);
    await prisma.$transaction(async (tx) => {
      await tx.creatorLicence.delete({ where: { id } });
      await logActivity(
        ctx,
        {
          type: 'INFLUENCER_UPDATED',
          message: `${actor.name} removed ${inf.displayName}'s advertising licence for ${existing.countryCode}.`,
          influencerId: existing.influencerId,
          meta: { countryCode: existing.countryCode },
        },
        tx,
      );
    });
  }

  /**
   * Each creator on the campaign's roster (still working on it) against the
   * campaign's countries that need a licence.
   */
  async function forCampaign(campaignId: string): Promise<CampaignLicenceCheckDTO> {
    await requireCapability(ctx, 'CAMPAIGNS_VIEW');
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, brandId: true, endDate: true, marketCountryCodes: true },
    });
    if (!campaign || isBrandOutOfScope(await scopedBrandIds(ctx), campaign.brandId)) {
      throw AppError.notFound('Campaign');
    }
    const checked = countriesToCheck(campaign.marketCountryCodes, await requiredCountries());
    const countryScope = await scopedCountryCodes(ctx);
    const roster = checked.length
      ? await prisma.campaignInfluencer.findMany({
          where: {
            campaignId,
            participationStatus: { in: [...LICENCE_CHECKED_STATUSES] },
            ...(countryScope ? { influencer: { countryCode: { in: countryScope } } } : {}),
          },
          select: {
            id: true,
            participationStatus: true,
            influencer: {
              select: {
                id: true,
                displayName: true,
                licences: {
                  where: { countryCode: { in: checked } },
                  select: { id: true, countryCode: true, number: true, expiresAt: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const now = new Date();
    return {
      campaignId,
      markets: campaign.marketCountryCodes,
      checkedCountries: checked,
      creators: roster.map((ci) => {
        const checks = checkCreator(checked, ci.influencer.licences, campaign.endDate, now).map(
          (c) => ({
            countryCode: c.countryCode,
            state: c.state,
            licenceId: c.licence?.id ?? null,
            number: c.licence?.number ?? null,
            expiresAt: iso(c.licence?.expiresAt ?? null),
          }),
        );
        return {
          campaignInfluencerId: ci.id,
          influencerId: ci.influencer.id,
          influencerName: ci.influencer.displayName,
          participationStatus: ci.participationStatus,
          checks,
          ok: checks.every((c) => c.state === 'VALID'),
        };
      }),
    };
  }

  /**
   * Campaigns with creators who have agreed to post but lack a licence that
   * covers the campaign (Needs Attention). No capability check: the caller
   * (dashboard.attention) passes its own brand/campaign filter; creators
   * outside the viewer's country scope aren't counted.
   */
  async function campaignIssues(
    where: Prisma.CampaignWhereInput,
    limit: number,
  ): Promise<
    {
      campaign: { id: string; name: string; brandId: string; status: string };
      missing: number;
      expiring: number;
    }[]
  > {
    const required = await requiredCountries();
    if (!required.length) return [];
    const countryScope = await scopedCountryCodes(ctx);
    const campaigns = await prisma.campaign.findMany({
      where: {
        AND: [
          where,
          {
            status: { in: [...LICENCE_CAMPAIGN_STATUSES] },
            marketCountryCodes: { hasSome: required },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        brandId: true,
        status: true,
        endDate: true,
        marketCountryCodes: true,
        campaignInfluencers: {
          where: {
            participationStatus: { in: [...LICENCE_ALERT_STATUSES] },
            ...(countryScope ? { influencer: { countryCode: { in: countryScope } } } : {}),
          },
          select: {
            influencer: {
              select: { licences: { select: { countryCode: true, expiresAt: true } } },
            },
          },
        },
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });
    const now = new Date();
    const out: {
      campaign: { id: string; name: string; brandId: string; status: string };
      missing: number;
      expiring: number;
    }[] = [];
    for (const c of campaigns) {
      const countries = countriesToCheck(c.marketCountryCodes, required);
      let missing = 0;
      let expiring = 0;
      for (const ci of c.campaignInfluencers) {
        const states = checkCreator(countries, ci.influencer.licences, c.endDate, now).map(
          (r) => r.state,
        );
        if (states.some((s) => s === 'MISSING' || s === 'EXPIRED')) missing++;
        else if (states.includes('EXPIRES_DURING')) expiring++;
      }
      if (missing || expiring)
        out.push({
          campaign: { id: c.id, name: c.name, brandId: c.brandId, status: c.status },
          missing,
          expiring,
        });
      if (out.length >= limit) break;
    }
    return out;
  }

  async function settings(): Promise<ComplianceSettingsDTO> {
    await requireCapability(ctx, 'CAMPAIGNS_VIEW');
    return { licenceCountryCodes: await requiredCountries() };
  }

  async function updateSettings(input: SettingsUpdate): Promise<ComplianceSettingsDTO> {
    const actor = requireAdmin(ctx);
    const existing = await prisma.clientConfig.findFirst({ select: { id: true } });
    if (existing) {
      await prisma.clientConfig.update({
        where: { id: existing.id },
        data: { licenceCountryCodes: input.licenceCountryCodes },
      });
    } else {
      await prisma.clientConfig.create({
        data: { licenceCountryCodes: input.licenceCountryCodes },
      });
    }
    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} changed the countries where creators need an advertising licence.`,
      meta: { licenceCountryCodes: input.licenceCountryCodes },
    });
    return { licenceCountryCodes: input.licenceCountryCodes };
  }

  return {
    listForInfluencer,
    create,
    update,
    remove,
    forCampaign,
    campaignIssues,
    settings,
    updateSettings,
    requiredCountries,
  };
}

export type LicenceService = ReturnType<typeof makeLicenceService>;
