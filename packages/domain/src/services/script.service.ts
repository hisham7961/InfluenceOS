import { requests, type ScriptDTO, type ScriptVersionDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { logActivity } from '../lib/helpers';

/*
 * Versioned scripts/references (ScriptReference + ScriptReferenceVersion).
 * Each ScriptReference tracks a `currentVersion` pointer while every edit is
 * preserved as an immutable ScriptReferenceVersion row — history is never
 * overwritten (mirrors the SocialMetricSnapshot pattern for social growth).
 */

type ScriptCreate = z.infer<typeof requests.scriptCreateSchema>;
type ScriptVersionInput = z.infer<typeof requests.scriptVersionSchema>;

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
  };
}

interface ScriptLike {
  id: string;
  title: string;
  campaignId: string | null;
  currentVersion: number;
  updatedAt: Date;
  versions: ScriptVersionLike[];
}

function toScriptDTO(s: ScriptLike): ScriptDTO {
  return {
    id: s.id,
    title: s.title,
    campaignId: s.campaignId,
    currentVersion: s.currentVersion,
    versions: s.versions.map(toScriptVersionDTO),
    updatedAt: s.updatedAt.toISOString(),
  };
}

const versionsInclude = {
  orderBy: { version: 'desc' },
  include: { createdBy: { select: { name: true } } },
} as const;

export function makeScriptService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function detail(id: string): Promise<ScriptDTO> {
    const script = await prisma.scriptReference.findUnique({
      where: { id },
      include: { versions: versionsInclude },
    });
    if (!script) throw AppError.notFound('Script');
    return toScriptDTO(script);
  }

  async function listForCampaign(campaignId: string): Promise<ScriptDTO[]> {
    const scripts = await prisma.scriptReference.findMany({
      where: { campaignId },
      orderBy: { updatedAt: 'desc' },
      include: { versions: versionsInclude },
    });
    return scripts.map(toScriptDTO);
  }

  async function create(input: ScriptCreate): Promise<ScriptDTO> {
    const actor = requireActor(ctx);

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
    const actor = requireActor(ctx);
    const script = await prisma.scriptReference.findUnique({ where: { id } });
    if (!script) throw AppError.notFound('Script');

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

  return { create, addVersion, detail, listForCampaign };
}

export type ScriptService = ReturnType<typeof makeScriptService>;
