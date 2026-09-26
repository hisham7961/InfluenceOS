import { createHash, randomBytes } from 'node:crypto';
import type {
  CreatorLinkDTO,
  CreatorPortalDTO,
  CreatorTaskDTO,
  UploadTicketDTO,
} from '@influenceos/contracts';
import type { requests, z } from '@influenceos/contracts';
import { appRoutes, mergeCaptionRules } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { disclosureRequiredFor } from '../lib/caption-rules';
import { requireAnyCapability } from '../lib/authz';
import { open, seal } from '../lib/crypto';
import { createNotification, iso, logActivity } from '../lib/helpers';
import { isLikelyBot } from '../lib/sales';
import { isCountryOutOfScope, scopedCountryCodes } from '../lib/scope';
import { buildStorageKey, getStorage, sanitizeFileName } from '../lib/storage';
import { signUploadTicket, verifyUploadTicket, type UploadTicket } from '../lib/tokens';
import { maxUploadBytes } from './attachment.service';
import { makeCampaignService } from './campaign.service';

type LinkCreate = z.infer<typeof requests.creatorLinkCreateSchema>;
type DraftInput = z.infer<typeof requests.creatorDraftSchema>;
type PostedInput = z.infer<typeof requests.creatorPostedSchema>;
type UploadInput = z.infer<typeof requests.creatorDraftUploadSchema>;

/** What a creator may upload as a draft: a photo or a video, nothing else. */
const DRAFT_FILE_TYPES: Record<string, 'image' | 'video'> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
};
/** An upload ticket from a task link lasts long enough for a big video on a phone. */
const UPLOAD_TTL_SECONDS = 3600;

const DAY_MS = 86_400_000;
/** Nothing left for the creator to send on these. */
const FINISHED = new Set(['PUBLISHED', 'VERIFIED', 'CANCELLED', 'MISSED']);
/** A creator who left the campaign loses the link. */
const LEFT = new Set(['DECLINED', 'DROPPED']);

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Creator task links (P3.3): one creator's part of one campaign, without an
 * account — the brief, their deliverables with due dates and requirements,
 * the approved script, their drafts with the team's decision and note, and
 * where they send a new draft or the live post link. Nothing about money or
 * the team's internal notes and comments is shown. Only a hash of the token
 * finds the link; the token is kept encrypted so it can be copied again.
 */
export function makeCreatorLinkService(ctx: DomainContext) {
  const { prisma } = ctx;
  // What the creator does is recorded without a team member as the actor,
  // even when someone signed in happens to open the link.
  const asCreator: DomainContext = { ...ctx, actor: null };

  async function rosterRowInScope(campaignInfluencerId: string) {
    const ci = await prisma.campaignInfluencer.findUnique({
      where: { id: campaignInfluencerId },
      select: {
        id: true,
        campaignId: true,
        influencerId: true,
        influencer: { select: { displayName: true, countryCode: true } },
      },
    });
    if (!ci) throw AppError.notFound('Campaign influencer');
    const campaign = await makeCampaignService(ctx).assertInScope(ci.campaignId);
    if (isCountryOutOfScope(await scopedCountryCodes(ctx), ci.influencer.countryCode)) {
      throw AppError.notFound('Campaign influencer');
    }
    return { ...ci, brandId: campaign.brandId };
  }

  type Row = Awaited<ReturnType<typeof rows>>[number];
  function rows(where: { campaignInfluencerId: string } | { id: string }) {
    return prisma.creatorAccessLink.findMany({
      where,
      include: { createdBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  function toDTO(r: Row, now = new Date()): CreatorLinkDTO {
    const token = open(r.tokenSealed);
    return {
      id: r.id,
      campaignInfluencerId: r.campaignInfluencerId,
      path: token ? `/share/c/${token}` : '',
      locale: r.locale === 'en' ? 'en' : 'ar',
      expiresAt: iso(r.expiresAt),
      revokedAt: iso(r.revokedAt),
      active: !r.revokedAt && (!r.expiresAt || r.expiresAt > now),
      openCount: r.openCount,
      lastOpenedAt: iso(r.lastOpenedAt),
      createdByName: r.createdBy?.name ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async function list(campaignInfluencerId: string): Promise<CreatorLinkDTO[]> {
    await requireAnyCapability(ctx, ['CAMPAIGNS_MANAGE', 'INFLUENCERS_MANAGE']);
    await rosterRowInScope(campaignInfluencerId);
    return (await rows({ campaignInfluencerId })).map((r) => toDTO(r));
  }

  async function create(campaignInfluencerId: string, input: LinkCreate): Promise<CreatorLinkDTO> {
    const actor = await requireAnyCapability(ctx, ['CAMPAIGNS_MANAGE', 'INFLUENCERS_MANAGE']);
    const ci = await rosterRowInScope(campaignInfluencerId);
    const token = randomBytes(32).toString('base64url');
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.creatorAccessLink.create({
        data: {
          campaignInfluencerId,
          tokenHash: hashToken(token),
          tokenSealed: seal(token),
          locale: input.locale,
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
          message: `${actor.name} made a task link for ${ci.influencer.displayName}.`,
          brandId: ci.brandId,
          campaignId: ci.campaignId,
          influencerId: ci.influencerId,
          meta: { creatorLinkId: row.id },
        },
        tx,
      );
      return row;
    });
    return toDTO((await rows({ id: created.id }))[0]!);
  }

  async function revoke(id: string): Promise<CreatorLinkDTO> {
    const actor = await requireAnyCapability(ctx, ['CAMPAIGNS_MANAGE', 'INFLUENCERS_MANAGE']);
    const link = await prisma.creatorAccessLink.findUnique({
      where: { id },
      select: { campaignInfluencerId: true, revokedAt: true },
    });
    if (!link) throw AppError.notFound('Task link');
    const ci = await rosterRowInScope(link.campaignInfluencerId).catch(() => {
      throw AppError.notFound('Task link');
    });
    if (!link.revokedAt) {
      await prisma.$transaction(async (tx) => {
        await tx.creatorAccessLink.update({ where: { id }, data: { revokedAt: new Date() } });
        await logActivity(
          ctx,
          {
            type: 'CAMPAIGN_UPDATED',
            message: `${actor.name} turned off ${ci.influencer.displayName}'s task link.`,
            brandId: ci.brandId,
            campaignId: ci.campaignId,
            influencerId: ci.influencerId,
            meta: { creatorLinkId: id },
          },
          tx,
        );
      });
    }
    return toDTO((await rows({ id }))[0]!);
  }

  // --- Public (the creator, no account) -------------------------------------

  /** The link behind a token, if it still works and the creator is still on the campaign. */
  async function linkFor(token: string) {
    const link = await prisma.creatorAccessLink.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        campaignInfluencer: {
          select: {
            id: true,
            campaignId: true,
            influencerId: true,
            participationStatus: true,
            influencer: { select: { displayName: true } },
            campaign: { select: { brandId: true, status: true } },
          },
        },
      },
    });
    if (
      !link ||
      link.revokedAt ||
      (link.expiresAt && link.expiresAt <= new Date()) ||
      LEFT.has(link.campaignInfluencer.participationStatus) ||
      link.campaignInfluencer.campaign.status === 'CANCELLED'
    ) {
      throw AppError.notFound('Task link');
    }
    return link;
  }

  async function portal(link: Awaited<ReturnType<typeof linkFor>>): Promise<CreatorPortalDTO> {
    const ci = await prisma.campaignInfluencer.findUniqueOrThrow({
      where: { id: link.campaignInfluencerId },
      select: {
        dealType: true,
        influencer: { select: { displayName: true } },
        campaign: {
          select: {
            name: true,
            startDate: true,
            endDate: true,
            brief: true,
            draftReview: true,
            brand: { select: { name: true, logoUrl: true } },
          },
        },
        deliverables: {
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
          select: {
            id: true,
            platform: true,
            type: true,
            quantity: true,
            dueDate: true,
            requirements: true,
            requiredHashtags: true,
            requiredMentions: true,
            status: true,
            creatorPostUrl: true,
            creatorPostedAt: true,
            scriptReference: {
              select: {
                title: true,
                approvedVersion: true,
                versions: {
                  select: {
                    version: true,
                    body: true,
                    captionSuggestion: true,
                    talkingPoints: true,
                    dos: true,
                    donts: true,
                    requiredClaims: true,
                    hashtags: true,
                    mentions: true,
                    referenceLinks: true,
                  },
                },
              },
            },
            submissions: {
              orderBy: { version: 'desc' },
              select: {
                id: true,
                version: true,
                status: true,
                assetUrl: true,
                attachment: { select: { fileName: true } },
                caption: true,
                notes: true,
                fromCreator: true,
                reviewNote: true,
                reviewedAt: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    const tasks: CreatorTaskDTO[] = ci.deliverables.map((d) => {
      const approved = d.scriptReference?.approvedVersion
        ? d.scriptReference.versions.find((v) => v.version === d.scriptReference!.approvedVersion)
        : undefined;
      const waiting = d.submissions.some((s) => s.status === 'IN_REVIEW');
      const finished = FINISHED.has(d.status);
      return {
        id: d.id,
        platform: d.platform,
        type: d.type,
        quantity: d.quantity,
        dueDate: iso(d.dueDate),
        requirements: d.requirements,
        requiredHashtags: d.requiredHashtags,
        requiredMentions: d.requiredMentions,
        status: d.status,
        script:
          approved && d.scriptReference
            ? {
                title: d.scriptReference.title,
                version: approved.version,
                body: approved.body,
                captionSuggestion: approved.captionSuggestion,
                talkingPoints: approved.talkingPoints,
                dos: approved.dos,
                donts: approved.donts,
                requiredClaims: approved.requiredClaims,
                hashtags: approved.hashtags,
                mentions: approved.mentions,
                referenceLinks: approved.referenceLinks,
              }
            : null,
        drafts: d.submissions.map((s) => ({
          id: s.id,
          version: s.version,
          status: s.status,
          assetUrl: s.assetUrl,
          fileName: s.attachment?.fileName ?? null,
          caption: s.caption,
          notes: s.notes,
          fromCreator: s.fromCreator,
          feedback: s.reviewNote,
          reviewedAt: iso(s.reviewedAt),
          createdAt: s.createdAt.toISOString(),
        })),
        captionRules: mergeCaptionRules(
          d,
          approved ?? null,
          disclosureRequiredFor(ci.dealType, d.type),
        ),
        postUrl: d.creatorPostUrl,
        postedAt: iso(d.creatorPostedAt),
        canSendDraft: !finished && d.status !== 'APPROVED' && !waiting,
        canSendPost: !finished,
      };
    });

    return {
      locale: link.locale === 'en' ? 'en' : 'ar',
      creatorName: ci.influencer.displayName,
      campaign: {
        name: ci.campaign.name,
        brandName: ci.campaign.brand.name,
        brandLogoUrl: ci.campaign.brand.logoUrl,
        startDate: iso(ci.campaign.startDate),
        endDate: iso(ci.campaign.endDate),
        brief: ci.campaign.brief,
        draftReview: ci.campaign.draftReview,
      },
      tasks,
      expiresAt: iso(link.expiresAt),
    };
  }

  /** The creator opened their link. A person's visit is counted; link previews aren't. */
  async function openPortal(
    token: string,
    visit: { userAgent?: string | null; preview?: boolean },
  ): Promise<CreatorPortalDTO> {
    const link = await linkFor(token);
    const dto = await portal(link);
    if (!visit.preview && !isLikelyBot(visit.userAgent)) {
      await prisma.creatorAccessLink
        .update({
          where: { id: link.id },
          data: { openCount: { increment: 1 }, lastOpenedAt: new Date() },
        })
        .catch(() => undefined);
    }
    return dto;
  }

  async function taskFor(link: Awaited<ReturnType<typeof linkFor>>, deliverableId: string) {
    const d = await prisma.deliverable.findUnique({
      where: { id: deliverableId },
      select: { id: true, campaignInfluencerId: true, status: true, creatorPostUrl: true },
    });
    // Only this creator's own deliverables on this campaign.
    if (!d || d.campaignInfluencerId !== link.campaignInfluencerId)
      throw AppError.notFound('Deliverable');
    return d;
  }

  /** A task that can take a new draft now (not approved or finished). */
  async function draftableTask(link: Awaited<ReturnType<typeof linkFor>>, deliverableId: string) {
    const d = await taskFor(link, deliverableId);
    if (FINISHED.has(d.status) || d.status === 'APPROVED') {
      throw AppError.conflict('This task is already approved or finished.');
    }
    return d;
  }

  /**
   * The creator starts uploading a draft file: a photo or a video, up to the
   * upload size limit, into private storage under this deliverable. Returns
   * where to send the bytes (straight to storage, or through the link's own
   * upload address); the draft itself is sent with the ticket afterwards.
   */
  async function startUpload(token: string, deliverableId: string, input: UploadInput): Promise<UploadTicketDTO> {
    const link = await linkFor(token);
    const d = await draftableTask(link, deliverableId);
    const kind = DRAFT_FILE_TYPES[input.mimeType];
    if (!kind) throw AppError.validation('Send a photo or a video (JPG, PNG, WebP, GIF, MP4, MOV or WebM).');
    const max = maxUploadBytes();
    if (input.sizeBytes > max) {
      throw AppError.validation(`The file is too big — up to ${Math.round(max / (1024 * 1024))} MB.`);
    }
    const fileName = sanitizeFileName(input.fileName);
    const storageKey = buildStorageKey(`deliverable/${d.id}`, fileName);
    const ticket = await signUploadTicket(
      {
        storageKey,
        fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        kind,
        actorId: '',
        target: { deliverableId: d.id, creatorLinkId: link.id },
      },
      UPLOAD_TTL_SECONDS,
    );
    const presignedPut = await getStorage().presignPut(storageKey, input.mimeType, UPLOAD_TTL_SECONDS, input.sizeBytes);
    return {
      uploadToken: ticket,
      uploadUrl:
        presignedPut ?? `/api/v1/public/creator/${encodeURIComponent(token)}/uploads?ticket=${encodeURIComponent(ticket)}`,
      method: 'PUT',
      direct: Boolean(presignedPut),
      headers: presignedPut ? { 'Content-Type': input.mimeType } : {},
      maxBytes: max,
    };
  }

  /** A ticket this link issued (for this deliverable, when one is given). */
  async function ticketFor(
    link: Awaited<ReturnType<typeof linkFor>>,
    ticket: string,
    deliverableId?: string,
  ): Promise<UploadTicket> {
    const t = await verifyUploadTicket(ticket).catch(() => {
      throw AppError.validation('The upload has expired. Please choose the file again.');
    });
    if (t.target.creatorLinkId !== link.id || (deliverableId && t.target.deliverableId !== deliverableId)) {
      throw AppError.notFound('Upload');
    }
    return t;
  }

  /** The file's bytes, when storage can't take them directly (local storage). */
  async function writeUpload(token: string, ticket: string, body: Buffer): Promise<void> {
    const link = await linkFor(token);
    const t = await ticketFor(link, ticket);
    if (body.length === 0) throw AppError.validation('The file is empty.');
    if (body.length > maxUploadBytes() || body.length > t.sizeBytes) {
      throw AppError.validation('The file is bigger than it said it was.');
    }
    await getStorage().save(t.storageKey, body, t.mimeType);
  }

  /** The creator sends a draft for review from their link. */
  async function sendDraft(
    token: string,
    deliverableId: string,
    input: DraftInput,
  ): Promise<CreatorPortalDTO> {
    const link = await linkFor(token);
    const d = await draftableTask(link, deliverableId);
    // An uploaded file must be this link's upload for this task, and in storage.
    let upload: { ticket: UploadTicket; size: number } | null = null;
    if (input.uploadToken) {
      const ticket = await ticketFor(link, input.uploadToken, d.id);
      const head = await getStorage().head(ticket.storageKey);
      if (!head) throw AppError.validation('The file did not finish uploading. Please try again.');
      if (head.size > maxUploadBytes()) {
        await getStorage().remove(ticket.storageKey).catch(() => undefined);
        throw AppError.validation('The file is too big.');
      }
      upload = { ticket, size: head.size };
    }
    const ci = link.campaignInfluencer;
    const name = ci.influencer.displayName;
    await prisma.$transaction(async (tx) => {
      // Locked per deliverable so two quick taps can't both become "the" draft.
      await tx.$queryRaw`SELECT id FROM "Deliverable" WHERE id = ${d.id} FOR UPDATE`;
      const waiting = await tx.deliverableSubmission.count({
        where: { deliverableId: d.id, status: 'IN_REVIEW' },
      });
      if (waiting > 0) throw AppError.conflict('Your last draft is still being reviewed.');
      const last = await tx.deliverableSubmission.findFirst({
        where: { deliverableId: d.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (last?.version ?? 0) + 1;
      // The file becomes an attachment of the deliverable (no uploader: the
      // creator has no account). One upload makes one draft.
      const file = upload
        ? await tx.attachment
            .create({
              data: {
                fileName: upload.ticket.fileName.slice(0, 200),
                mimeType: upload.ticket.mimeType,
                sizeBytes: upload.size,
                storageKey: upload.ticket.storageKey,
                kind: upload.ticket.kind,
                deliverableId: d.id,
              },
              select: { id: true },
            })
            .catch((err: unknown) => {
              if ((err as { code?: string }).code === 'P2002') {
                throw AppError.conflict('This file was already sent.');
              }
              throw err;
            })
        : null;
      const sub = await tx.deliverableSubmission.create({
        data: {
          deliverableId: d.id,
          version,
          status: 'IN_REVIEW',
          assetUrl: input.assetUrl ?? null,
          attachmentId: file?.id ?? null,
          caption: input.caption ?? null,
          notes: input.notes ?? null,
          fromCreator: true,
        },
      });
      await tx.deliverable.update({ where: { id: d.id }, data: { status: 'IN_REVIEW' } });
      await logActivity(
        asCreator,
        {
          type: 'DELIVERABLE_STATUS_CHANGED',
          message: `${name} sent draft v${version} from their task link.`,
          brandId: ci.campaign.brandId,
          campaignId: ci.campaignId,
          influencerId: ci.influencerId,
          deliverableId: d.id,
          meta: { submissionId: sub.id, version, via: 'creator_link' },
        },
        tx,
      );
      await createNotification(
        asCreator,
        {
          category: 'GENERAL',
          title: 'Draft sent by the creator',
          body: `${name} sent draft v${version} for review.`,
          targetUrl: appRoutes.campaign(ci.campaignId, 'submissions'),
          brandId: ci.campaign.brandId,
          campaignId: ci.campaignId,
          influencerId: ci.influencerId,
        },
        tx,
      );
    });
    return portal(link);
  }

  /** The creator says the post is live and sends its link, for the team to check and add. */
  async function sendPost(
    token: string,
    deliverableId: string,
    input: PostedInput,
  ): Promise<CreatorPortalDTO> {
    const link = await linkFor(token);
    const d = await taskFor(link, deliverableId);
    if (FINISHED.has(d.status)) throw AppError.conflict('This task is already finished.');
    const ci = link.campaignInfluencer;
    const name = ci.influencer.displayName;
    await prisma.$transaction(async (tx) => {
      await tx.deliverable.update({
        where: { id: d.id },
        data: { creatorPostUrl: input.url, creatorPostedAt: new Date() },
      });
      await logActivity(
        asCreator,
        {
          type: 'DELIVERABLE_STATUS_CHANGED',
          message: `${name} sent the link to their live post.`,
          brandId: ci.campaign.brandId,
          campaignId: ci.campaignId,
          influencerId: ci.influencerId,
          deliverableId: d.id,
          meta: { url: input.url, via: 'creator_link' },
        },
        tx,
      );
      await createNotification(
        asCreator,
        {
          category: 'GENERAL',
          title: 'The creator says the post is live',
          body: `${name} sent the link to their live post. Check it and add it to the campaign.`,
          targetUrl: appRoutes.campaign(ci.campaignId, 'deliverables'),
          brandId: ci.campaign.brandId,
          campaignId: ci.campaignId,
          influencerId: ci.influencerId,
        },
        tx,
      );
    });
    return portal(link);
  }

  return { list, create, revoke, open: openPortal, startUpload, writeUpload, sendDraft, sendPost };
}

export type CreatorLinkService = ReturnType<typeof makeCreatorLinkService>;
