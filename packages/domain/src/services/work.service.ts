import type {
  ApprovalItemDTO,
  MyWorkDTO,
  WorkCountsDTO,
  WorkItemDTO,
} from '@influenceos/contracts';
import type { Prisma } from '@influenceos/database';
import { appRoutes } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { requireActor } from '../lib/authz';
import { dueWithinWhere, overdueWhere } from '../lib/deliverable-rules';
import { iso } from '../lib/helpers';
import { scopedBrandIds, scopedCountryCodes } from '../lib/scope';
import { submissionInclude, toSubmissionDTO } from './submission.service';

/** "Due soon" on My work: today and the next 3 days (Kuwait calendar). */
const DUE_SOON_DAYS = 3;
const LIST_LIMIT = 50;
const OPEN_SHIPMENT_STATUSES = ['PENDING', 'SHIPPED', 'IN_TRANSIT'] as const;

/**
 * My work and the approvals list (P3.6). "Mine" is what the person owns — a
 * campaign they own, or a creator they own — plus shipments and address
 * issues assigned to them. Everything respects brand and country scope, the
 * same way the lists these items come from do.
 */
export function makeWorkService(ctx: DomainContext) {
  const { prisma } = ctx;

  /** Roster rows the viewer may see (brand scope on the campaign, country scope on the creator). */
  async function rosterScope(): Promise<Prisma.CampaignInfluencerWhereInput> {
    const [brands, countries] = await Promise.all([scopedBrandIds(ctx), scopedCountryCodes(ctx)]);
    return {
      ...(brands ? { campaign: { brandId: { in: brands } } } : {}),
      ...(countries ? { influencer: { countryCode: { in: countries } } } : {}),
    };
  }

  /** Roster rows the viewer owns: their campaign, or their creator. */
  function mine(userId: string): Prisma.CampaignInfluencerWhereInput {
    return { OR: [{ campaign: { ownerId: userId } }, { influencer: { ownerId: userId } }] };
  }

  const avatar = (i: { avatarOverrideUrl: string | null; resolvedAvatarUrl: string | null }) =>
    i.avatarOverrideUrl ?? i.resolvedAvatarUrl ?? null;

  const rosterSelect = {
    id: true,
    campaign: {
      select: { id: true, name: true, ownerId: true, brand: { select: { name: true } } },
    },
    influencer: {
      select: {
        id: true,
        displayName: true,
        ownerId: true,
        avatarOverrideUrl: true,
        resolvedAvatarUrl: true,
      },
    },
  } as const;

  /** Drafts waiting for review across campaigns, oldest first. */
  async function approvals(opts: { mine?: boolean } = {}): Promise<ApprovalItemDTO[]> {
    const actor = requireActor(ctx);
    const scope = await rosterScope();
    const rows = await prisma.deliverableSubmission.findMany({
      where: {
        status: 'IN_REVIEW',
        deliverable: {
          campaignInfluencer: { AND: [scope, ...(opts.mine ? [mine(actor.id)] : [])] },
        },
      },
      include: {
        ...submissionInclude,
        deliverable: {
          select: {
            id: true,
            type: true,
            platform: true,
            dueDate: true,
            campaignInfluencer: { select: rosterSelect },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return Promise.all(
      rows.map(async (r) => {
        const ci = r.deliverable.campaignInfluencer;
        return {
          submission: await toSubmissionDTO(r),
          campaign: { id: ci.campaign.id, name: ci.campaign.name },
          brandName: ci.campaign.brand.name,
          campaignInfluencerId: ci.id,
          creator: {
            id: ci.influencer.id,
            name: ci.influencer.displayName,
            avatarUrl: avatar(ci.influencer),
          },
          deliverable: {
            id: r.deliverable.id,
            type: r.deliverable.type,
            platform: r.deliverable.platform,
            dueDate: iso(r.deliverable.dueDate),
          },
          mine: ci.campaign.ownerId === actor.id || ci.influencer.ownerId === actor.id,
        };
      }),
    );
  }

  async function myWork(): Promise<MyWorkDTO> {
    const actor = requireActor(ctx);
    const scope = await rosterScope();
    const own = { AND: [scope, mine(actor.id)] };
    const now = new Date();
    const [ownsCampaign, ownsCreator, drafts, overdue, dueSoon, shipments, issues, found] =
      await Promise.all([
        prisma.campaign.count({ where: { ownerId: actor.id } }),
        prisma.influencer.count({ where: { ownerId: actor.id } }),
        prisma.deliverableSubmission.findMany({
          where: { status: 'IN_REVIEW', deliverable: { campaignInfluencer: own } },
          select: {
            id: true,
            createdAt: true,
            deliverable: {
              select: { type: true, platform: true, campaignInfluencer: { select: rosterSelect } },
            },
          },
          orderBy: { createdAt: 'asc' },
          take: LIST_LIMIT,
        }),
        prisma.deliverable.findMany({
          where: { AND: [overdueWhere(now), { campaignInfluencer: own }] },
          select: {
            id: true,
            type: true,
            platform: true,
            dueDate: true,
            campaignInfluencer: { select: rosterSelect },
          },
          orderBy: { dueDate: 'asc' },
          take: LIST_LIMIT,
        }),
        prisma.deliverable.findMany({
          where: { AND: [dueWithinWhere(DUE_SOON_DAYS, now), { campaignInfluencer: own }] },
          select: {
            id: true,
            type: true,
            platform: true,
            dueDate: true,
            campaignInfluencer: { select: rosterSelect },
          },
          orderBy: { dueDate: 'asc' },
          take: LIST_LIMIT,
        }),
        prisma.productShipment.findMany({
          where: {
            assignedToUserId: actor.id,
            status: { in: [...OPEN_SHIPMENT_STATUSES] },
            campaignInfluencer: scope,
          },
          select: {
            id: true,
            status: true,
            createdAt: true,
            campaignInfluencer: { select: rosterSelect },
          },
          orderBy: { createdAt: 'asc' },
          take: LIST_LIMIT,
        }),
        prisma.logisticsIssue.findMany({
          where: {
            assignedToUserId: actor.id,
            status: 'OPEN',
            shipment: { campaignInfluencer: scope },
          },
          select: {
            id: true,
            type: true,
            createdAt: true,
            shipment: { select: { campaignInfluencer: { select: rosterSelect } } },
          },
          orderBy: { createdAt: 'asc' },
          take: LIST_LIMIT,
        }),
        prisma.discoveredPost.groupBy({
          by: ['campaignId'],
          where: { status: 'NEW', campaignInfluencer: own },
          _count: { _all: true },
          _min: { foundAt: true },
        }),
      ]);

    type Roster = {
      id: string;
      campaign: { id: string; name: string };
      influencer: {
        id: string;
        displayName: string;
        avatarOverrideUrl: string | null;
        resolvedAvatarUrl: string | null;
      };
    };
    const who = (ci: Roster) => ({
      campaign: { id: ci.campaign.id, name: ci.campaign.name },
      creator: {
        id: ci.influencer.id,
        name: ci.influencer.displayName,
        avatarUrl: avatar(ci.influencer),
      },
    });

    const items: WorkItemDTO[] = [];
    for (const d of drafts) {
      const ci = d.deliverable.campaignInfluencer;
      items.push({
        id: `draft-${d.id}`,
        kind: 'DRAFT_TO_REVIEW',
        ...who(ci),
        at: d.createdAt.toISOString(),
        link: `${appRoutes.campaign(ci.campaign.id, 'submissions')}`,
        params: { type: d.deliverable.type, platform: d.deliverable.platform },
      });
    }
    for (const d of overdue) {
      items.push({
        id: `overdue-${d.id}`,
        kind: 'DELIVERABLE_OVERDUE',
        ...who(d.campaignInfluencer),
        at: iso(d.dueDate),
        link: appRoutes.campaign(d.campaignInfluencer.campaign.id, 'deliverables'),
        params: { type: d.type, platform: d.platform },
      });
    }
    for (const d of dueSoon) {
      items.push({
        id: `due-${d.id}`,
        kind: 'DELIVERABLE_DUE_SOON',
        ...who(d.campaignInfluencer),
        at: iso(d.dueDate),
        link: appRoutes.campaign(d.campaignInfluencer.campaign.id, 'deliverables'),
        params: { type: d.type, platform: d.platform },
      });
    }
    for (const s of shipments) {
      items.push({
        id: `shipment-${s.id}`,
        kind: 'SHIPMENT',
        ...who(s.campaignInfluencer),
        at: s.createdAt.toISOString(),
        link: appRoutes.campaign(s.campaignInfluencer.campaign.id, 'shipments'),
        params: { status: s.status },
      });
    }
    for (const i of issues) {
      items.push({
        id: `issue-${i.id}`,
        kind: 'LOGISTICS_ISSUE',
        ...who(i.shipment.campaignInfluencer),
        at: i.createdAt.toISOString(),
        link: appRoutes.campaign(i.shipment.campaignInfluencer.campaign.id, 'shipments'),
        params: { issueType: i.type },
      });
    }
    if (found.length) {
      const names = new Map(
        (
          await prisma.campaign.findMany({
            where: { id: { in: found.map((f) => f.campaignId) } },
            select: { id: true, name: true },
          })
        ).map((c) => [c.id, c.name]),
      );
      for (const f of found) {
        items.push({
          id: `found-${f.campaignId}`,
          kind: 'FOUND_POSTS',
          campaign: { id: f.campaignId, name: names.get(f.campaignId) ?? '' },
          creator: null,
          at: iso(f._min.foundAt),
          link: appRoutes.campaign(f.campaignId, 'content'),
          params: { count: f._count._all },
        });
      }
    }
    return { items, ownsAnything: ownsCampaign + ownsCreator > 0 };
  }

  /** Sidebar badges: the viewer's own open items, and every draft waiting in their scope. */
  async function counts(): Promise<WorkCountsDTO> {
    const actor = requireActor(ctx);
    const scope = await rosterScope();
    const own = { AND: [scope, mine(actor.id)] };
    const now = new Date();
    const [drafts, overdue, dueSoon, shipments, issues, foundCampaigns, approvalsCount] =
      await Promise.all([
        prisma.deliverableSubmission.count({
          where: { status: 'IN_REVIEW', deliverable: { campaignInfluencer: own } },
        }),
        prisma.deliverable.count({
          where: { AND: [overdueWhere(now), { campaignInfluencer: own }] },
        }),
        prisma.deliverable.count({
          where: { AND: [dueWithinWhere(DUE_SOON_DAYS, now), { campaignInfluencer: own }] },
        }),
        prisma.productShipment.count({
          where: {
            assignedToUserId: actor.id,
            status: { in: [...OPEN_SHIPMENT_STATUSES] },
            campaignInfluencer: scope,
          },
        }),
        prisma.logisticsIssue.count({
          where: {
            assignedToUserId: actor.id,
            status: 'OPEN',
            shipment: { campaignInfluencer: scope },
          },
        }),
        prisma.discoveredPost.groupBy({
          by: ['campaignId'],
          where: { status: 'NEW', campaignInfluencer: own },
        }),
        prisma.deliverableSubmission.count({
          where: { status: 'IN_REVIEW', deliverable: { campaignInfluencer: scope } },
        }),
      ]);
    const cap = (n: number) => Math.min(n, LIST_LIMIT);
    return {
      myWork:
        cap(drafts) +
        cap(overdue) +
        cap(dueSoon) +
        cap(shipments) +
        cap(issues) +
        foundCampaigns.length,
      approvals: approvalsCount,
    };
  }

  return { approvals, myWork, counts };
}

export type WorkService = ReturnType<typeof makeWorkService>;
