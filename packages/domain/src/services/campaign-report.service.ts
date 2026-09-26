import type {
  CampaignReportCreatorDTO,
  CampaignReportDTO,
  CampaignReportPostDTO,
  Platform,
  ReportTargetDTO,
} from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { requests } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { hasCapability } from '../lib/capabilities';
import { iso } from '../lib/helpers';
import { toMoneyNumber } from '../lib/money';
import { isBrandOutOfScope, scopedBrandIds } from '../lib/scope';
import { makeAnalyticsService } from './analytics.service';
import { makeSalesService } from './sales.service';

type ReportQuery = z.infer<typeof requests.campaignReportQuerySchema>;

const GONE = new Set(['REMOVED', 'PRIVATE', 'UNAVAILABLE', 'BROKEN_LINK']);

/** Share of a target reached, rounded to a whole percent. */
function against(actual: number | null, target: number | null): ReportTargetDTO {
  return {
    actual,
    target,
    percent:
      actual != null && target != null && target > 0 ? Math.round((actual / target) * 100) : null,
  };
}

/**
 * The client report for one campaign (P2.2): promised against delivered, per
 * creator and per post, in the language the brand reads. It is built from
 * the same numbers as the Performance tab (campaignEfficiency) so the two can
 * never disagree. Costs are included only when asked for AND the reader may
 * see money (FINANCE_VIEW); otherwise every cost field is null.
 */
export function makeCampaignReportService(ctx: DomainContext) {
  const { prisma } = ctx;

  const reportCampaignSelect = {
    id: true,
    name: true,
    brandId: true,
    objective: true,
    startDate: true,
    endDate: true,
    currency: true,
    plannedBudget: true,
    targetViews: true,
    targetEngagements: true,
    targetEngagementRate: true,
    targetCostPerView: true,
    reportSummary: true,
    brand: { select: { name: true, logoUrl: true } },
  } as const;
  type ReportCampaign = NonNullable<Awaited<ReturnType<typeof loadCampaign>>>;

  function loadCampaign(where: { id: string } | { OR: { id?: string; slug?: string }[] }) {
    return prisma.campaign.findFirst({ where, select: reportCampaignSelect });
  }

  async function forCampaign(idOrSlug: string, query: ReportQuery): Promise<CampaignReportDTO> {
    const actor = requireActor(ctx);
    const campaign = await loadCampaign({ OR: [{ id: idOrSlug }, { slug: idOrSlug }] });
    if (!campaign) throw AppError.notFound('Campaign');
    const scope = await scopedBrandIds(ctx);
    if (isBrandOutOfScope(scope, campaign.brandId)) throw AppError.notFound('Campaign');

    const includeCosts = (query.costs ?? true) && (await hasCapability(ctx, 'FINANCE_VIEW'));
    const me = await prisma.user.findUnique({ where: { id: actor.id }, select: { locale: true } });
    const locale = query.locale ?? (me?.locale === 'ar' ? 'ar' : 'en');
    return build(campaign, locale, includeCosts);
  }

  /** A campaign's report by id, with the language and costs already decided (shared links, P3.3). */
  async function forCampaignAs(campaignId: string, locale: 'en' | 'ar', includeCosts: boolean): Promise<CampaignReportDTO> {
    const campaign = await loadCampaign({ id: campaignId });
    if (!campaign) throw AppError.notFound('Campaign');
    return build(campaign, locale, includeCosts);
  }

  async function build(campaign: ReportCampaign, locale: 'en' | 'ar', includeCosts: boolean): Promise<CampaignReportDTO> {
    const [efficiency, posts, roster] = await Promise.all([
      makeAnalyticsService(ctx).campaignEfficiency(campaign.id),
      prisma.publishedContent.findMany({
        where: { campaignId: campaign.id },
        select: {
          id: true,
          platform: true,
          originalUrl: true,
          thumbnailUrl: true,
          caption: true,
          publishedAt: true,
          availabilityStatus: true,
          influencer: { select: { displayName: true } },
        },
      }),
      prisma.campaignInfluencer.findMany({
        where: { campaignId: campaign.id },
        select: {
          id: true,
          influencer: {
            select: {
              socialAccounts: {
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                select: { platform: true, username: true },
              },
            },
          },
        },
      }),
    ]);

    // Sales from codes and links (P3.1). Return on spend reveals spend, so it
    // follows the report's costs switch.
    const sold = await makeSalesService(ctx).campaignTotals(campaign.id, campaign.currency, includeCosts);
    const hasSales = sold.orders > 0 || sold.clicks > 0;
    const salesByCreator = new Map(sold.creators.map((c) => [c.influencerId, c]));

    const accountsByRow = new Map(roster.map((r) => [r.id, r.influencer.socialAccounts]));
    const creators: CampaignReportCreatorDTO[] = efficiency.perCreator.map((c) => {
      const accounts = accountsByRow.get(c.campaignInfluencerId) ?? [];
      return {
        influencerId: c.influencerId,
        name: c.influencerName,
        handle: accounts[0]?.username ?? null,
        platforms: [...new Set(accounts.map((a) => a.platform as Platform))],
        postsLive: c.postsLive,
        postsPlanned: c.postsPlanned,
        views: c.views,
        engagements: c.engagements,
        engagementRate: c.engagementRate,
        spend: includeCosts ? c.spend : null,
        costPerView: includeCosts ? c.costPerView : null,
        sales: hasSales
          ? { orders: salesByCreator.get(c.influencerId)?.orders ?? 0, revenue: salesByCreator.get(c.influencerId)?.revenue ?? [] }
          : null,
      };
    });

    const perContent = new Map(efficiency.perContent.map((p) => [p.contentId, p]));
    const reportPosts: CampaignReportPostDTO[] = posts
      .map((p) => {
        const m = perContent.get(p.id);
        return {
          id: p.id,
          creatorName: p.influencer?.displayName ?? null,
          platform: p.platform as Platform,
          // A Story has no public link (its media is stored with us).
          url: p.originalUrl.startsWith('story://') ? null : p.originalUrl,
          thumbnailUrl: p.thumbnailUrl,
          caption: p.caption,
          publishedAt: iso(p.publishedAt),
          removed: GONE.has(p.availabilityStatus),
          views: m?.views ?? null,
          engagements: m?.totalEngagement ?? null,
          engagementRate: m?.engagementRate ?? null,
          costPerView: includeCosts ? (m?.costPerView ?? null) : null,
        };
      })
      // Best first; posts without numbers after, newest first among them.
      .sort(
        (a, b) =>
          (b.views ?? -1) - (a.views ?? -1) ||
          (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
      );

    const postsPlanned = creators.reduce((s, c) => s + c.postsPlanned, 0);
    // Every post still up counts, including one not yet tied to a creator.
    const postsLive = reportPosts.filter((p) => !p.removed).length;
    const targetCpv = toMoneyNumber(campaign.targetCostPerView);
    const cpv = includeCosts ? efficiency.costPerView : null;

    return {
      locale,
      includeCosts,
      generatedAt: new Date().toISOString(),
      campaign: {
        id: campaign.id,
        name: campaign.name,
        brandName: campaign.brand.name,
        brandLogoUrl: campaign.brand.logoUrl,
        objective: campaign.objective,
        startDate: iso(campaign.startDate),
        endDate: iso(campaign.endDate),
        currency: efficiency.currency,
      },
      summary: campaign.reportSummary,
      totals: {
        creators: creators.length,
        postsPlanned,
        postsLive,
        postsWithMetrics: efficiency.contentWithMetrics,
        views: against(efficiency.totalViews, campaign.targetViews),
        engagements: against(efficiency.totalEngagement, campaign.targetEngagements),
        engagementRate: against(efficiency.avgEngagementRate, campaign.targetEngagementRate),
        spend: includeCosts ? efficiency.totalSpend : null,
        plannedBudget: includeCosts ? toMoneyNumber(campaign.plannedBudget) : null,
        // Cheaper than promised is good: how far under (or over) the target CPV.
        costPerView: {
          actual: cpv,
          target: includeCosts ? targetCpv : null,
          percent:
            includeCosts && cpv != null && cpv > 0 && targetCpv != null
              ? Math.round((targetCpv / cpv) * 100)
              : null,
        },
        costPerEngagement: includeCosts ? efficiency.costPerEngagement : null,
      },
      metricsLastSyncedAt: efficiency.metricsLastSyncedAt,
      sales: hasSales
        ? {
            orders: sold.orders,
            revenue: sold.revenue,
            clicks: sold.clicks,
            roas: sold.roas,
            costPerOrder: sold.costPerOrder,
          }
        : null,
      creators,
      posts: reportPosts,
    };
  }

  return { forCampaign, forCampaignAs };
}

export type CampaignReportService = ReturnType<typeof makeCampaignReportService>;
