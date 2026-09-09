import type {
  ActiveCampaignCardDTO,
  ActivityDTO,
  AttentionItemDTO,
  BrandDashboardDTO,
  GlobalDashboardDTO,
  PulseDTO,
  UpcomingContentDTO,
  WhatsNewItemDTO,
} from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { moneyNumberOr0, sumMoney } from '../lib/money';
import { toActivityDTO } from '../lib/mappers';
import { makeBrandService } from './brand.service';
import { makeCampaignService } from './campaign.service';
import { makeContentService } from './content.service';

const REMOVED_STATUSES = ['REMOVED', 'PRIVATE', 'UNAVAILABLE', 'BROKEN_LINK'] as const;
const OPEN_DELIVERABLE_STATUSES = ['PLANNED', 'SENT_TO_INFLUENCER', 'AWAITING_PUBLICATION'] as const;

export function makeDashboardService(ctx: DomainContext) {
  const { prisma } = ctx;
  const content = makeContentService(ctx);
  const campaigns = makeCampaignService(ctx);

  const brandFilter = (brandId?: string) => (brandId ? { brandId } : {});
  const deliverableBrandFilter = (brandId?: string) =>
    brandId ? { campaignInfluencer: { campaign: { brandId } } } : {};

  async function totalSpend(brandId?: string): Promise<number> {
    const campaignWhere = brandId ? { campaign: { brandId } } : {};
    const [fees, expenses] = await Promise.all([
      prisma.campaignInfluencer.aggregate({
        _sum: { agreedCost: true },
        where: { ...campaignWhere, dealType: { in: ['PAID', 'PAID_PLUS_GIFTED'] } },
      }),
      prisma.campaignExpense.aggregate({
        _sum: { amount: true },
        where: { ...campaignWhere, type: { not: 'GIFT_PRODUCT' } },
      }),
    ]);
    return moneyNumberOr0(sumMoney([fees._sum.agreedCost, expenses._sum.amount]));
  }

  async function pulse(brandId?: string): Promise<PulseDTO> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 864e5);
    const in14 = new Date(now.getTime() + 14 * 864e5);

    const [
      activeCampaigns,
      activeInfluencerRows,
      contentPublishedThisWeek,
      upcomingDeliverables,
      overdueDeliverables,
      spend,
      contentAlerts,
    ] = await Promise.all([
      prisma.campaign.count({ where: { status: 'ACTIVE', ...brandFilter(brandId) } }),
      prisma.campaignInfluencer.findMany({
        where: { campaign: { status: 'ACTIVE', ...(brandId ? { brandId } : {}) } },
        select: { influencerId: true },
        distinct: ['influencerId'],
      }),
      prisma.publishedContent.count({
        where: { detectedAt: { gte: weekAgo }, ...brandFilter(brandId) },
      }),
      prisma.deliverable.count({
        where: {
          dueDate: { gte: now, lte: in14 },
          status: { in: [...OPEN_DELIVERABLE_STATUSES] },
          ...deliverableBrandFilter(brandId),
        },
      }),
      prisma.deliverable.count({
        where: {
          dueDate: { lt: now },
          status: { in: [...OPEN_DELIVERABLE_STATUSES] },
          ...deliverableBrandFilter(brandId),
        },
      }),
      totalSpend(brandId),
      prisma.publishedContent.count({
        where: { availabilityStatus: { in: [...REMOVED_STATUSES] }, ...brandFilter(brandId) },
      }),
    ]);

    return {
      activeCampaigns,
      activeInfluencers: activeInfluencerRows.length,
      contentPublishedThisWeek,
      upcomingDeliverables,
      overdueDeliverables,
      totalSpend: spend,
      currency: 'KWD',
      contentAlerts,
    };
  }

  async function whatsNew(brandId?: string, limit = 14): Promise<WhatsNewItemDTO[]> {
    const recentContent = await prisma.publishedContent.findMany({
      where: brandFilter(brandId),
      include: content.relInclude,
      orderBy: [{ detectedAt: 'desc' }],
      take: limit,
    });
    const items: WhatsNewItemDTO[] = recentContent.map((pc) => {
      const dto = content.mapRow(pc);
      return {
        id: `content-${pc.id}`,
        kind: 'CONTENT_PUBLISHED',
        at: dto.detectedAt,
        content: dto,
        title: dto.influencer?.displayName ?? `${pc.platform} content`,
        subtitle: dto.campaign?.name ?? null,
        link: `/content/${pc.id}`,
      };
    });
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  }

  async function attention(brandId?: string, limit = 12): Promise<AttentionItemDTO[]> {
    const now = new Date();
    const in5 = new Date(now.getTime() + 5 * 864e5);
    const out: AttentionItemDTO[] = [];

    const [overdue, removed, endingSoon] = await Promise.all([
      prisma.deliverable.findMany({
        where: {
          dueDate: { lt: now },
          status: { in: [...OPEN_DELIVERABLE_STATUSES] },
          ...deliverableBrandFilter(brandId),
        },
        include: {
          campaignInfluencer: {
            select: {
              campaignId: true,
              influencer: { select: { displayName: true } },
              campaign: { select: { name: true } },
            },
          },
        },
        orderBy: { dueDate: 'asc' },
        take: limit,
      }),
      prisma.publishedContent.findMany({
        where: { availabilityStatus: { in: [...REMOVED_STATUSES] }, ...brandFilter(brandId) },
        include: { influencer: { select: { displayName: true } } },
        orderBy: { lastCheckedAt: 'desc' },
        take: limit,
      }),
      prisma.campaign.findMany({
        where: { status: 'ACTIVE', endDate: { gte: now, lte: in5 }, ...brandFilter(brandId) },
        orderBy: { endDate: 'asc' },
        take: limit,
      }),
    ]);

    for (const d of overdue) {
      out.push({
        id: `overdue-${d.id}`,
        kind: 'DELIVERABLE_OVERDUE',
        title: `Deliverable overdue — ${d.campaignInfluencer.influencer.displayName}`,
        description: `A ${d.type.toLowerCase()} for ${d.campaignInfluencer.campaign.name} passed its due date.`,
        severity: 'danger',
        link: `/campaigns/${d.campaignInfluencer.campaignId}`,
        at: (d.dueDate ?? d.createdAt).toISOString(),
      });
    }
    for (const c of removed) {
      out.push({
        id: `removed-${c.id}`,
        kind: c.availabilityStatus === 'REMOVED' ? 'CONTENT_REMOVED' : 'CONTENT_UNAVAILABLE',
        title: `Content ${c.availabilityStatus.toLowerCase()}`,
        description: `A ${c.platform} post${c.influencer ? ` by ${c.influencer.displayName}` : ''} is ${c.availabilityStatus.toLowerCase()}.`,
        severity: 'warning',
        link: `/content/${c.id}`,
        at: (c.lastCheckedAt ?? c.detectedAt).toISOString(),
      });
    }
    for (const c of endingSoon) {
      out.push({
        id: `ending-${c.id}`,
        kind: 'CAMPAIGN_ENDING',
        title: `${c.name} ends soon`,
        description: `This campaign ends on ${c.endDate?.toISOString().slice(0, 10)}.`,
        severity: 'warning',
        link: `/campaigns/${c.id}`,
        at: (c.endDate ?? now).toISOString(),
      });
    }

    const severityRank = (s: string) => (s === 'danger' ? 0 : 1);
    return out.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)).slice(0, limit);
  }

  async function activeCampaignCards(brandId?: string, limit = 6): Promise<ActiveCampaignCardDTO[]> {
    const result = await campaigns.list({
      page: 1,
      pageSize: limit,
      order: 'desc',
      ...(brandId ? { brandId } : {}),
      status: 'ACTIVE',
    } as Parameters<typeof campaigns.list>[0]);
    return result.data.map((campaign) => ({ campaign }));
  }

  async function upcomingContent(brandId?: string, limit = 8): Promise<UpcomingContentDTO[]> {
    const now = new Date();
    const in14 = new Date(now.getTime() + 14 * 864e5);
    const rows = await prisma.campaignInfluencer.findMany({
      where: {
        expectedPublishAt: { gte: now, lte: in14 },
        ...(brandId ? { campaign: { brandId } } : {}),
      },
      include: {
        influencer: { select: { displayName: true, primaryPlatform: true, avatarOverrideUrl: true, resolvedAvatarUrl: true } },
        campaign: { select: { name: true, brand: { select: { name: true } } } },
        deliverables: { select: { platform: true }, take: 1 },
      },
      orderBy: { expectedPublishAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      influencerName: r.influencer.displayName,
      influencerAvatarUrl: r.influencer.avatarOverrideUrl ?? r.influencer.resolvedAvatarUrl ?? null,
      platform: r.deliverables[0]?.platform ?? r.influencer.primaryPlatform ?? 'INSTAGRAM',
      campaignName: r.campaign.name,
      brandName: r.campaign.brand.name,
      expectedAt: (r.expectedPublishAt ?? now).toISOString(),
    }));
  }

  async function recentActivity(brandId?: string, limit = 10): Promise<ActivityDTO[]> {
    const rows = await prisma.activityLog.findMany({
      where: brandId ? { brandId } : {},
      include: { actor: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map(toActivityDTO);
  }

  async function global(brandId?: string): Promise<GlobalDashboardDTO> {
    const [pulseData, whatsNewData, attentionData, activeData, upcomingData, activityData] =
      await Promise.all([
        pulse(brandId),
        whatsNew(brandId),
        attention(brandId),
        activeCampaignCards(brandId),
        upcomingContent(brandId),
        recentActivity(brandId),
      ]);
    return {
      pulse: pulseData,
      whatsNew: whatsNewData,
      attention: attentionData,
      activeCampaigns: activeData,
      upcomingContent: upcomingData,
      recentActivity: activityData,
    };
  }

  async function brand(idOrSlug: string): Promise<BrandDashboardDTO> {
    const brandSvc = makeBrandService(ctx);
    const detail = await brandSvc.detail(idOrSlug);
    const dash = await global(detail.id);
    return { ...dash, brand: detail };
  }

  return { global, brand, pulse, whatsNew, attention };
}

export type DashboardService = ReturnType<typeof makeDashboardService>;
