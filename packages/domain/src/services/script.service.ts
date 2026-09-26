import { requests, type ScriptDTO, type ScriptVersionDTO, type ScriptVersionStatus } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireCapability } from '../lib/authz';
import { createNotification, iso, logActivity } from '../lib/helpers';
import { makeCampaignService } from './campaign.service';

/*
 * Versioned scripts/references (ScriptReference + ScriptReferenceVersion).
 * Each ScriptReference tracks a `currentVersion` pointer while every edit is
 * preserved as an immutable ScriptReferenceVersion row — history is never
 * overwritten (mirrors the SocialMetricSnapshot pattern for social growth).
 */

type ScriptCreate = z.infer<typeof requests.scriptCreateSchema>;
type ScriptVersionInput = z.infer<typeof requests.scriptVersionSchema>;
type ScriptVersionStatusInput = z.infer<typeof requests.scriptVersionStatusSchema>;

interface ScriptVersionLike {
  id: string;
  version: number;
  body: string | null;
  captionSuggestion: string | null;
  talkingPoints: string[];
  dos: string[];
  donts: string[];
  requiredClaims: string[];
  hashtags: string[];
  mentions: string[];
  referenceLinks: string[];
  internalComments: string | null;
  createdAt: Date;
  createdBy: { name: string } | null;
  status: ScriptVersionStatus;
  reviewedAt: Date | null;
  reviewNote: string | null;
  reviewedBy: { name: string } | null;
}

function toScriptVersionDTO(v: ScriptVersionLike): ScriptVersionDTO {
  return {
    id: v.id,
    version: v.version,
    body: v.body,
    captionSuggestion: v.captionSuggestion,
    talkingPoints: v.talkingPoints,
    dos: v.dos,
    donts: v.donts,
    requiredClaims: v.requiredClaims,
    hashtags: v.hashtags,
    mentions: v.mentions,
    referenceLinks: v.referenceLinks,
    internalComments: v.internalComments,
    createdByName: v.createdBy?.name ?? null,
    createdAt: v.createdAt.toISOString(),
    status: v.status,
    reviewedByName: v.reviewedBy?.name ?? null,
    reviewedAt: iso(v.reviewedAt),
    reviewNote: v.reviewNote,
  };
}

interface ScriptLike {
  id: string;
  title: string;
  campaignId: string | null;
  currentVersion: number;
  approvedVersion: number | null;
  updatedAt: Date;
  versions: ScriptVersionLike[];
}

function toScriptDTO(s: ScriptLike): ScriptDTO {
  return {
    id: s.id,
    title: s.title,
    campaignId: s.campaignId,
    currentVersion: s.currentVersion,
    approvedVersion: s.approvedVersion,
    versions: s.versions.map(toScriptVersionDTO),
    updatedAt: s.updatedAt.toISOString(),
  };
}

const versionsInclude = {
  orderBy: { version: 'desc' },
  include: { createdBy: { select: { name: true } }, reviewedBy: { select: { name: true } } },
} as const;

/** What each move through the brand's approval is called in the activity log. */
const STATUS_VERB: Record<ScriptVersionStatus, string> = {
  DRAFT: 'moved back to draft',
  SENT_TO_BRAND: 'sent to the brand',
  CHANGES_REQUESTED: 'marked as sent back by the brand with changes',
  APPROVED: 'marked as approved by the brand',
};

export function makeScriptService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function detail(id: string): Promise<ScriptDTO> {
    const script = await prisma.scriptReference.findUnique({
      where: { id },
      include: { versions: versionsInclude },
    });
    if (!script) throw AppError.notFound('Script');
    // A campaign's script is that campaign's brand's: a brand-limited user
    // can't read another brand's script by guessing its id.
    if (script.campaignId) {
      await makeCampaignService(ctx)
        .assertInScope(script.campaignId)
        .catch(() => {
          throw AppError.notFound('Script');
        });
    }
    return toScriptDTO(script);
  }

  async function listForCampaign(campaignId: string): Promise<ScriptDTO[]> {
    await makeCampaignService(ctx).assertInScope(campaignId);
    const scripts = await prisma.scriptReference.findMany({
      where: { campaignId },
      orderBy: { updatedAt: 'desc' },
      include: { versions: versionsInclude },
    });
    return scripts.map(toScriptDTO);
  }

  async function create(input: ScriptCreate): Promise<ScriptDTO> {
    // Capability grants WHAT the actor can do; scope grants WHERE (Security &
    // Authorization Freeze Gate) — this was previously a bare requireActor.
    const actor = await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    // A script isn't always attached to a campaign (campaignId is optional),
    // but when it is, a brand-scoped actor must not create it under a
    // campaign outside their brand access.
    if (input.campaignId) await makeCampaignService(ctx).assertInScope(input.campaignId);

    if (input.deliverableId) {
      const deliverable = await prisma.deliverable.findUnique({
        where: { id: input.deliverableId },
      });
      if (!deliverable) throw AppError.notFound('Deliverable');
    }

    const script = await prisma.scriptReference.create({
      data: {
        campaignId: input.campaignId ?? null,
        title: input.title,
        currentVersion: 1,
        versions: {
          create: {
            version: 1,
            body: input.body ?? null,
            captionSuggestion: input.captionSuggestion ?? null,
            talkingPoints: input.talkingPoints ?? [],
            dos: input.dos ?? [],
            donts: input.donts ?? [],
            requiredClaims: input.requiredClaims ?? [],
            hashtags: input.hashtags ?? [],
            mentions: input.mentions ?? [],
            referenceLinks: input.referenceLinks ?? [],
            internalComments: input.internalComments ?? null,
            createdById: actor.id,
          },
        },
      },
    });

    if (input.deliverableId) {
      await prisma.deliverable.update({
        where: { id: input.deliverableId },
        data: { scriptReferenceId: script.id },
      });
    }

    await logActivity(ctx, {
      type: 'SCRIPT_ADDED',
      message: `${actor.name} added the script "${script.title}".`,
      campaignId: script.campaignId,
    });

    return detail(script.id);
  }

  async function addVersion(id: string, input: ScriptVersionInput): Promise<ScriptDTO> {
    const actor = await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const script = await prisma.scriptReference.findUnique({ where: { id } });
    if (!script) throw AppError.notFound('Script');
    if (script.campaignId) await makeCampaignService(ctx).assertInScope(script.campaignId);

    const newVersion = script.currentVersion + 1;
    await prisma.scriptReferenceVersion.create({
      data: {
        scriptReferenceId: script.id,
        version: newVersion,
        body: input.body ?? null,
        captionSuggestion: input.captionSuggestion ?? null,
        talkingPoints: input.talkingPoints ?? [],
        dos: input.dos ?? [],
        donts: input.donts ?? [],
        requiredClaims: input.requiredClaims ?? [],
        hashtags: input.hashtags ?? [],
        mentions: input.mentions ?? [],
        referenceLinks: input.referenceLinks ?? [],
        internalComments: input.internalComments ?? null,
        createdById: actor.id,
      },
    });
    await prisma.scriptReference.update({
      where: { id: script.id },
      data: { currentVersion: newVersion },
    });

    await logActivity(ctx, {
      type: 'SCRIPT_UPDATED',
      message: `${actor.name} added version ${newVersion} to the script "${script.title}".`,
      campaignId: script.campaignId,
    });

    return detail(id);
  }

  /**
   * Move one version through the brand's approval: sent to the brand, sent
   * back with changes (the note says what), or approved. The approved
   * version becomes the one creators follow; taking approval away from it
   * clears that.
   */
  async function setVersionStatus(id: string, version: number, input: ScriptVersionStatusInput): Promise<ScriptDTO> {
    const actor = await requireCapability(ctx, 'CAMPAIGNS_MANAGE');
    const script = await prisma.scriptReference.findUnique({ where: { id } });
    if (!script) throw AppError.notFound('Script');
    if (script.campaignId) await makeCampaignService(ctx).assertInScope(script.campaignId);
    const row = await prisma.scriptReferenceVersion.findUnique({
      where: { scriptReferenceId_version: { scriptReferenceId: id, version } },
      select: { id: true, status: true },
    });
    if (!row) throw AppError.notFound('Script version');

    const reset = input.status === 'DRAFT';
    const approvedVersion =
      input.status === 'APPROVED' ? version : script.approvedVersion === version ? null : script.approvedVersion;
    await prisma.$transaction(async (tx) => {
      await tx.scriptReferenceVersion.update({
        where: { id: row.id },
        data: {
          status: input.status,
          reviewedById: reset ? null : actor.id,
          reviewedAt: reset ? null : new Date(),
          reviewNote: reset ? null : (input.note ?? null),
        },
      });
      if (approvedVersion !== script.approvedVersion) {
        await tx.scriptReference.update({ where: { id }, data: { approvedVersion } });
      }
      await logActivity(
        ctx,
        {
          type: 'SCRIPT_UPDATED',
          message: `${actor.name}: version ${version} of the script "${script.title}" ${STATUS_VERB[input.status]}.`,
          campaignId: script.campaignId,
          meta: { scriptReferenceId: id, version, status: input.status },
        },
        tx,
      );
      if (input.status === 'APPROVED' || input.status === 'CHANGES_REQUESTED') {
        await createNotification(
          ctx,
          {
            category: 'GENERAL',
            title:
              input.status === 'APPROVED'
                ? `Script approved: ${script.title} (v${version})`
                : `Changes requested on the script ${script.title} (v${version})`,
            body: input.note ?? null,
            campaignId: script.campaignId,
          },
          tx,
        );
      }
    });
    return detail(id);
  }

  return { create, addVersion, detail, listForCampaign, setVersionStatus };
}

export type ScriptService = ReturnType<typeof makeScriptService>;
