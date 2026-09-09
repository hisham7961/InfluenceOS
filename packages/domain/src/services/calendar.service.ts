import { requests, type CalendarEventDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { iso } from '../lib/helpers';

type CalendarQuery = z.infer<typeof requests.calendarQuerySchema>;

/** True when `date` falls within [from, to] (inclusive). */
function within(date: Date | null, from: Date, to: Date): boolean {
  if (!date) return false;
  return date.getTime() >= from.getTime() && date.getTime() <= to.getTime();
}

export function makeCalendarService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function events(q: CalendarQuery): Promise<CalendarEventDTO[]> {
    const { from, to, brandId, campaignId, influencerId, platform } = q;

    // --- (1) Campaigns: start/end within range -----------------------------
    const campaignWhere: Prisma.CampaignWhereInput = {
      ...(brandId ? { brandId } : {}),
      ...(campaignId ? { id: campaignId } : {}),
      OR: [
        { startDate: { gte: from, lte: to } },
        { endDate: { gte: from, lte: to } },
      ],
    };

    // --- (2) Deliverables: dueDate within range -----------------------------
    const deliverableWhere: Prisma.DeliverableWhereInput = {
      dueDate: { gte: from, lte: to },
      ...(platform ? { platform } : {}),
      campaignInfluencer: {
        ...(influencerId ? { influencerId } : {}),
        ...(campaignId ? { campaignId } : {}),
        ...(brandId ? { campaign: { brandId } } : {}),
      },
    };

    // --- (3) CampaignInfluencer.expectedPublishAt within range --------------
    const expectedPublishWhere: Prisma.CampaignInfluencerWhereInput = {
      expectedPublishAt: { gte: from, lte: to },
      ...(influencerId ? { influencerId } : {}),
      ...(campaignId ? { campaignId } : {}),
      ...(brandId ? { campaign: { brandId } } : {}),
    };

    // --- (4) PublishedContent.publishedAt within range -----------------------
    const publishedWhere: Prisma.PublishedContentWhereInput = {
      publishedAt: { gte: from, lte: to },
      ...(platform ? { platform } : {}),
      ...(brandId ? { brandId } : {}),
      ...(campaignId ? { campaignId } : {}),
      ...(influencerId ? { influencerId } : {}),
    };

    const [campaigns, deliverables, expectedPublishes, published] = await Promise.all([
      prisma.campaign.findMany({
        where: campaignWhere,
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          brand: { select: { name: true, primaryColor: true } },
        },
      }),
      prisma.deliverable.findMany({
        where: deliverableWhere,
        select: {
          id: true,
          platform: true,
          type: true,
          dueDate: true,
          campaignInfluencer: {
            select: {
              campaignId: true,
              campaign: { select: { id: true, name: true, brand: { select: { name: true, primaryColor: true } } } },
              influencer: { select: { displayName: true } },
            },
          },
        },
      }),
      prisma.campaignInfluencer.findMany({
        where: expectedPublishWhere,
        select: {
          id: true,
          campaignId: true,
          expectedPublishAt: true,
          campaign: { select: { id: true, name: true, brand: { select: { name: true, primaryColor: true } } } },
          influencer: { select: { displayName: true } },
        },
      }),
      prisma.publishedContent.findMany({
        where: publishedWhere,
        select: {
          id: true,
          platform: true,
          publishedAt: true,
          campaignId: true,
          brand: { select: { name: true, primaryColor: true } },
          campaign: { select: { id: true, name: true } },
          influencer: { select: { displayName: true } },
        },
      }),
    ]);

    const result: CalendarEventDTO[] = [];

    for (const c of campaigns) {
      if (within(c.startDate, from, to)) {
        result.push({
          id: `camp-start-${c.id}`,
          kind: 'CAMPAIGN_START',
          title: `${c.name} starts`,
          date: iso(c.startDate) as string,
          platform: null,
          brandName: c.brand.name,
          brandColor: c.brand.primaryColor,
          campaignId: c.id,
          influencerName: null,
          link: `/campaigns/${c.id}`,
        });
      }
      if (within(c.endDate, from, to)) {
        result.push({
          id: `camp-end-${c.id}`,
          kind: 'CAMPAIGN_END',
          title: `${c.name} ends`,
          date: iso(c.endDate) as string,
          platform: null,
          brandName: c.brand.name,
          brandColor: c.brand.primaryColor,
          campaignId: c.id,
          influencerName: null,
          link: `/campaigns/${c.id}`,
        });
      }
    }

    for (const d of deliverables) {
      const campaign = d.campaignInfluencer.campaign;
      const influencerName = d.campaignInfluencer.influencer.displayName;
      result.push({
        id: `deliverable-${d.id}`,
        kind: 'DELIVERABLE_DUE',
        title: `${influencerName}: ${d.type} due (${campaign.name})`,
        date: iso(d.dueDate) as string,
        platform: d.platform,
        brandName: campaign.brand.name,
        brandColor: campaign.brand.primaryColor,
        campaignId: campaign.id,
        influencerName,
        link: `/campaigns/${campaign.id}`,
      });
    }

    for (const ep of expectedPublishes) {
      const campaign = ep.campaign;
      const influencerName = ep.influencer.displayName;
      result.push({
        id: `expected-publish-${ep.id}`,
        kind: 'EXPECTED_PUBLISH',
        title: `${influencerName} expected to publish (${campaign.name})`,
        date: iso(ep.expectedPublishAt) as string,
        platform: null,
        brandName: campaign.brand.name,
        brandColor: campaign.brand.primaryColor,
        campaignId: campaign.id,
        influencerName,
        link: `/campaigns/${campaign.id}`,
      });
    }

    for (const p of published) {
      const influencerName = p.influencer?.displayName ?? null;
      result.push({
        id: `published-${p.id}`,
        kind: 'PUBLISHED',
        title: influencerName ? `${influencerName} published on ${p.platform}` : `Content published on ${p.platform}`,
        date: iso(p.publishedAt) as string,
        platform: p.platform,
        brandName: p.brand?.name ?? null,
        brandColor: p.brand?.primaryColor ?? null,
        campaignId: p.campaign?.id ?? null,
        influencerName,
        link: `/content/${p.id}`,
      });
    }

    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }

  return { events };
}

export type CalendarService = ReturnType<typeof makeCalendarService>;
