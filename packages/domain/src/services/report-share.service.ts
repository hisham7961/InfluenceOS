import { createHash, randomBytes } from 'node:crypto';
import type { CampaignReportDTO, ReportShareDTO } from '@influenceos/contracts';
import type { requests, z } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireCapability } from '../lib/authz';
import { hasCapability } from '../lib/capabilities';
import { open, seal } from '../lib/crypto';
import { iso, logActivity } from '../lib/helpers';
import { isLikelyBot } from '../lib/sales';
import { isBrandOutOfScope, scopedBrandIds } from '../lib/scope';
import { makeCampaignReportService } from './campaign-report.service';

type ShareCreate = z.infer<typeof requests.reportShareCreateSchema>;

const DAY_MS = 86_400_000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * No-login links to a campaign's client report (P3.3), for the brand's team.
 * The link fixes the language and whether costs show; it can expire and be
 * turned off. Opening it rebuilds the report from live numbers. Only a hash
 * of the token is used to find the link; the token itself is kept encrypted
 * so the link can be copied again from the list.
 */
export function makeReportShareService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function campaignInScope(campaignId: string) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, brandId: true },
    });
    if (!campaign || isBrandOutOfScope(await scopedBrandIds(ctx), campaign.brandId))
      throw AppError.notFound('Campaign');
    return campaign;
  }

  type Row = Awaited<ReturnType<typeof rows>>[number];
  function rows(where: { campaignId: string } | { id: string }) {
    return prisma.reportShareLink.findMany({
      where,
      include: { createdBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  function toDTO(r: Row, now = new Date()): ReportShareDTO {
    const token = open(r.tokenSealed);
    return {
      id: r.id,
      campaignId: r.campaignId,
      path: token ? `/share/r/${token}` : '',
      locale: r.locale === 'ar' ? 'ar' : 'en',
      includeCosts: r.includeCosts,
      expiresAt: iso(r.expiresAt),
      revokedAt: iso(r.revokedAt),
      active: !r.revokedAt && (!r.expiresAt || r.expiresAt > now),
      viewCount: r.viewCount,
      lastViewedAt: iso(r.lastViewedAt),
      createdByName: r.createdBy?.name ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async function list(campaignId: string): Promise<ReportShareDTO[]> {
    await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    await campaignInScope(campaignId);
    return (await rows({ campaignId })).map((r) => toDTO(r));
  }

  async function create(campaignId: string, input: ShareCreate): Promise<ReportShareDTO> {
    const actor = await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const campaign = await campaignInScope(campaignId);
    if (input.includeCosts && !(await hasCapability(ctx, 'FINANCE_VIEW'))) {
      throw AppError.forbidden('Only people who can see costs can share them.');
    }
    const token = randomBytes(32).toString('base64url');
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.reportShareLink.create({
        data: {
          campaignId,
          tokenHash: hashToken(token),
          tokenSealed: seal(token),
          locale: input.locale,
          includeCosts: input.includeCosts,
          expiresAt: input.expiresInDays
            ? new Date(Date.now() + input.expiresInDays * DAY_MS)
            : null,
          createdById: actor.id,
        },
      });
      await logActivity(
        ctx,
        {
          type: 'CAMPAIGN_UPDATED',
          message: `${actor.name} shared the client report by link.`,
          brandId: campaign.brandId,
          campaignId,
          meta: { reportShareId: row.id, includeCosts: row.includeCosts },
        },
        tx,
      );
      return row;
    });
    return toDTO((await rows({ id: created.id }))[0]!);
  }

  async function revoke(id: string): Promise<ReportShareDTO> {
    const actor = await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const share = await prisma.reportShareLink.findUnique({
      where: { id },
      select: { id: true, campaignId: true, revokedAt: true },
    });
    if (!share) throw AppError.notFound('Report link');
    const campaign = await prisma.campaign.findUnique({
      where: { id: share.campaignId },
      select: { brandId: true },
    });
    if (!campaign || isBrandOutOfScope(await scopedBrandIds(ctx), campaign.brandId))
      throw AppError.notFound('Report link');
    if (!share.revokedAt) {
      await prisma.$transaction(async (tx) => {
        await tx.reportShareLink.update({ where: { id }, data: { revokedAt: new Date() } });
        await logActivity(
          ctx,
          {
            type: 'CAMPAIGN_UPDATED',
            message: `${actor.name} turned off a client report link.`,
            brandId: campaign.brandId,
            campaignId: share.campaignId,
            meta: { reportShareId: id },
          },
          tx,
        );
      });
    }
    return toDTO((await rows({ id }))[0]!);
  }

  /**
   * Someone opened a shared link (public, no sign-in). The report as it is
   * now, in the link's language, with costs only if the link includes them.
   * A person's visit is counted; link previews aren't.
   */
  async function open_(
    token: string,
    visit: { userAgent?: string | null; preview?: boolean },
  ): Promise<CampaignReportDTO> {
    const share = await prisma.reportShareLink.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!share || share.revokedAt || (share.expiresAt && share.expiresAt <= new Date())) {
      throw AppError.notFound('Report link');
    }
    const report = await makeCampaignReportService(ctx).forCampaignAs(
      share.campaignId,
      share.locale === 'ar' ? 'ar' : 'en',
      share.includeCosts,
    );
    if (!visit.preview && !isLikelyBot(visit.userAgent)) {
      await prisma.reportShareLink
        .update({
          where: { id: share.id },
          data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
        })
        .catch(() => undefined);
    }
    return report;
  }

  return { list, create, revoke, open: open_ };
}
