import { requests, type AttachmentDTO, type AttachmentKind, type UploadTicketDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor, requireAnyCapability, requireCapability, requireOwnerOrAdmin } from '../lib/authz';
import { logActivity } from '../lib/helpers';
import { isBrandOutOfScope, isCountryOutOfScope, scopedBrandIds, scopedCountryCodes } from '../lib/scope';
import { buildStorageKey, getStorage, resolveAttachmentDownloadUrl, sanitizeFileName } from '../lib/storage';
import { signUploadTicket, verifyDownloadTicket, verifyUploadTicket } from '../lib/tokens';
import { makeCampaignService } from './campaign.service';

type Target = z.infer<typeof requests.attachmentTargetSchema>;

/** Where live attachment files are stored, and where orphaned ones are parked. */
const LIVE_PREFIX = 'attachments/';
const QUARANTINE_PREFIX = 'quarantine/';
/** Platform feature flag that switches the orphaned-file pass off. */
const CLEANUP_FLAG = 'file_cleanup';

export interface UploadCleanupResult {
  /** Orphaned files moved to quarantine this run. */
  quarantined: number;
  /** Quarantined files moved back because a record references them again. */
  restored: number;
  /** Quarantined files deleted after the retention window. */
  purged: number;
  /** Orphaned files found (older than the grace window). */
  orphans: number;
  /** Why the orphan pass was refused, when it was. */
  skipped: null | 'disabled' | 'no-attachment-records' | 'too-many-orphans';
}
type InitiateInput = z.infer<typeof requests.attachmentInitiateSchema>;

/** Allowed MIME types → attachment kind. Anything else is rejected. */
const ALLOWED: Record<string, AttachmentKind> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'application/pdf': 'pdf',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'text/plain': 'document',
  'text/csv': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
};

export function maxUploadBytes(): number {
  return (Number(process.env.MAX_UPLOAD_MB) || 50) * 1024 * 1024;
}

export const attachmentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  storageKey: true,
  kind: true,
  campaignId: true,
  deliverableId: true,
  scriptReferenceId: true,
  influencerId: true,
  noteId: true,
  publishedContentId: true,
  campaignInfluencerId: true,
  createdAt: true,
  uploadedBy: { select: { name: true } },
} as const;

const selectRow = attachmentSelect;
export type AttachmentRow = Prisma.AttachmentGetPayload<{ select: typeof attachmentSelect }>;
type Row = AttachmentRow;

const SIGNED_URL_TTL = 600; // 10 minutes for download URLs

/** An attachment row as the API returns it, with a short-lived download link. */
export async function toAttachmentDTO(row: AttachmentRow): Promise<AttachmentDTO> {
  const kind = (row.kind ?? 'other') as AttachmentKind;
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    kind,
    downloadUrl: await resolveAttachmentDownloadUrl(row.id, row.storageKey, row.fileName, SIGNED_URL_TTL),
    isImage: kind === 'image',
    uploadedByName: row.uploadedBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The one target a stored attachment row points at, in scopeFor()'s order. */
function targetOf(row: Row): Target {
  return {
    campaignId: row.campaignId,
    deliverableId: row.deliverableId,
    scriptReferenceId: row.scriptReferenceId,
    influencerId: row.influencerId,
    noteId: row.noteId,
    publishedContentId: row.publishedContentId,
    campaignInfluencerId: row.campaignInfluencerId,
  };
}

export function makeAttachmentService(ctx: DomainContext) {
  const { prisma } = ctx;
  const storage = getStorage(process.env);

  const toDTO = toAttachmentDTO;

  function scopeFor(target: Target): { scope: string; where: Prisma.AttachmentWhereInput } {
    if (target.campaignId) return { scope: `campaign/${target.campaignId}`, where: { campaignId: target.campaignId } };
    if (target.deliverableId) return { scope: `deliverable/${target.deliverableId}`, where: { deliverableId: target.deliverableId } };
    if (target.scriptReferenceId) return { scope: `script/${target.scriptReferenceId}`, where: { scriptReferenceId: target.scriptReferenceId } };
    if (target.influencerId) return { scope: `influencer/${target.influencerId}`, where: { influencerId: target.influencerId } };
    if (target.noteId) return { scope: `note/${target.noteId}`, where: { noteId: target.noteId } };
    if (target.publishedContentId) return { scope: `content/${target.publishedContentId}`, where: { publishedContentId: target.publishedContentId } };
    if (target.campaignInfluencerId)
      return { scope: `roster/${target.campaignInfluencerId}`, where: { campaignInfluencerId: target.campaignInfluencerId } };
    throw AppError.badRequest(
      'An attachment must be linked to a campaign, deliverable, script, influencer, note, content item, or roster row.',
    );
  }

  async function assertTargetExists(target: Target): Promise<void> {
    if (target.campaignId && !(await prisma.campaign.count({ where: { id: target.campaignId } }))) throw AppError.notFound('Campaign');
    if (target.deliverableId && !(await prisma.deliverable.count({ where: { id: target.deliverableId } }))) throw AppError.notFound('Deliverable');
    if (target.scriptReferenceId && !(await prisma.scriptReference.count({ where: { id: target.scriptReferenceId } }))) throw AppError.notFound('Script');
    if (target.influencerId && !(await prisma.influencer.count({ where: { id: target.influencerId } }))) throw AppError.notFound('Influencer');
    if (target.noteId && !(await prisma.note.count({ where: { id: target.noteId } }))) throw AppError.notFound('Note');
    if (target.publishedContentId && !(await prisma.publishedContent.count({ where: { id: target.publishedContentId } })))
      throw AppError.notFound('Content');
    if (target.campaignInfluencerId && !(await prisma.campaignInfluencer.count({ where: { id: target.campaignInfluencerId } })))
      throw AppError.notFound('Campaign influencer');
  }

  /**
   * Resolve the campaign and/or influencer context an attachment target
   * implies, so initiate() (below) can apply the SAME capability + scope
   * posture every other campaign-child / influencer mutation in this
   * codebase uses, instead of only checking the target row exists
   * (Security & Authorization Freeze Gate). Walks the same relations
   * scopeFor()/assertTargetExists() already key off of — deliverable ->
   * campaignInfluencer -> campaign (a Deliverable always belongs to one),
   * scriptReference -> campaign (nullable — a script need not be tied to a
   * campaign), and note -> campaign / deliverable / influencer — and checks
   * fields in the SAME priority order scopeFor() does (campaignId,
   * deliverableId, scriptReferenceId, influencerId, noteId), so the
   * capability/scope check is always keyed off the exact field the upload's
   * storage scope and DB row use.
   *
   * A note scoped to a shipment, published-content item, inspiration item,
   * brand, or a general/logistics channel resolves to neither a campaign
   * nor an influencer here — note.service.ts's own resolveContext() is the
   * authority for those contexts (brand scope, shipment country scope,
   * logistics-channel capability) and re-deriving all of that here would be
   * guessing at rules owned by a concurrent pass on that file. initiate()
   * falls back to a conservative manage-capability check for that residual
   * case (see the comment there) rather than leaving it open to any actor.
   */
  async function resolveTargetContext(
    target: Target,
  ): Promise<{ campaignId: string | null; influencerId: string | null }> {
    if (target.campaignId) return { campaignId: target.campaignId, influencerId: null };

    if (target.deliverableId) {
      const d = await prisma.deliverable.findUnique({
        where: { id: target.deliverableId },
        select: { campaignInfluencer: { select: { campaignId: true } } },
      });
      return { campaignId: d?.campaignInfluencer.campaignId ?? null, influencerId: null };
    }

    if (target.scriptReferenceId) {
      const s = await prisma.scriptReference.findUnique({
        where: { id: target.scriptReferenceId },
        select: { campaignId: true },
      });
      return { campaignId: s?.campaignId ?? null, influencerId: null };
    }

    if (target.influencerId) return { campaignId: null, influencerId: target.influencerId };

    if (target.noteId) {
      const n = await prisma.note.findUnique({
        where: { id: target.noteId },
        select: { campaignId: true, deliverableId: true, influencerId: true },
      });
      if (n?.campaignId) return { campaignId: n.campaignId, influencerId: null };
      if (n?.deliverableId) {
        const d = await prisma.deliverable.findUnique({
          where: { id: n.deliverableId },
          select: { campaignInfluencer: { select: { campaignId: true } } },
        });
        return { campaignId: d?.campaignInfluencer.campaignId ?? null, influencerId: null };
      }
      if (n?.influencerId) return { campaignId: null, influencerId: n.influencerId };
      return { campaignId: null, influencerId: null };
    }

    if (target.campaignInfluencerId) {
      // A roster row is both: the campaign's brand scope and the creator's
      // country scope apply (the agreement is that creator's paperwork).
      const ci = await prisma.campaignInfluencer.findUnique({
        where: { id: target.campaignInfluencerId },
        select: { campaignId: true, influencerId: true },
      });
      return { campaignId: ci?.campaignId ?? null, influencerId: ci?.influencerId ?? null };
    }

    return { campaignId: null, influencerId: null };
  }

  /** The creator's country is outside the actor's country scope. */
  async function influencerOutOfCountryScope(influencerId: string): Promise<boolean> {
    const countryScope = await scopedCountryCodes(ctx);
    if (!countryScope) return false;
    const influencer = await prisma.influencer.findUnique({ where: { id: influencerId }, select: { countryCode: true } });
    return !influencer || isCountryOutOfScope(countryScope, influencer.countryCode);
  }

  /**
   * Read access to a target's files: the same brand and country scope as the
   * thing they're attached to. A brand-limited user can't list or open the
   * files of another brand's campaign, deliverable, script, post or roster
   * row by guessing its id; a country-limited user can't open a creator's
   * files outside their countries. Notes on other contexts (brand, shipment,
   * channel) resolve to neither and stay as note.service allows.
   */
  async function assertReadScope(target: Target): Promise<void> {
    if (target.publishedContentId) {
      const pc = await prisma.publishedContent.findUnique({
        where: { id: target.publishedContentId },
        select: { brandId: true, influencerId: true },
      });
      if (!pc) throw AppError.notFound('Content');
      const brandScope = await scopedBrandIds(ctx);
      if (pc.brandId && isBrandOutOfScope(brandScope, pc.brandId)) throw AppError.notFound('Content');
      if (pc.influencerId && (await influencerOutOfCountryScope(pc.influencerId))) throw AppError.notFound('Content');
      return;
    }
    const { campaignId, influencerId } = await resolveTargetContext(target);
    if (campaignId) await makeCampaignService(ctx).assertInScope(campaignId);
    if (influencerId && (await influencerOutOfCountryScope(influencerId))) throw AppError.notFound('Influencer');
  }

  function validateMeta(mimeType: string, sizeBytes: number): AttachmentKind {
    const kind = ALLOWED[mimeType];
    if (!kind) {
      throw AppError.badRequest(`Unsupported file type "${mimeType}". Allowed: images, PDF, video, documents.`);
    }
    const max = maxUploadBytes();
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw AppError.badRequest('File size must be greater than zero.');
    if (sizeBytes > max) {
      throw AppError.badRequest(`File too large — maximum ${Math.round(max / (1024 * 1024))} MB.`);
    }
    return kind;
  }

  /**
   * Phase 1 — reserve a storage key and mint an upload ticket. No DB row is
   * created yet, so an abandoned upload leaves no orphan record. For the S3
   * driver the client receives a presigned PUT URL and uploads directly; for
   * the local driver it PUTs bytes to the signed API proxy.
   */
  async function initiate(input: InitiateInput): Promise<UploadTicketDTO> {
    const actor = requireActor(ctx);
    const kind = validateMeta(input.mimeType, input.sizeBytes);
    const fileName = sanitizeFileName(input.fileName);
    const { scope } = scopeFor(input.target);
    await assertTargetExists(input.target);

    // Security & Authorization Freeze Gate — initiate() previously only
    // checked the target row EXISTS, with zero capability or scope check:
    // any authenticated actor could mint an upload ticket (and, via
    // complete(), create an Attachment row) against ANY campaign/
    // deliverable/script/influencer/note by id, regardless of role or brand/
    // country access. Resolve the target's effective campaign/influencer
    // context (see resolveTargetContext above) and require the same posture
    // every other campaign-child mutation (campaign-influencer.service.ts,
    // expense.service.ts) and influencer mutation (influencer.service.ts)
    // already enforces.
    if (input.target.publishedContentId) {
      // A Story upload attaches directly to the PublishedContent row it
      // belongs to — the SAME CONTENT_MANAGE + brand/creator-country scope
      // posture content.service.ts's own assertContentInScope enforces for
      // creating/reading that row, not the generic campaign/influencer
      // branches below (a piece of content need carry neither).
      await requireCapability(ctx, 'CONTENT_MANAGE');
      // Story media is a screenshot or screen recording only — never a PDF
      // or document, both otherwise-allowed kinds elsewhere in this
      // function. content.service.ts's mapRow() renders storyMedia as
      // either <img> or <video> based on this same kind, so an unsupported
      // kind here would otherwise silently render as a broken image.
      if (kind !== 'image' && kind !== 'video') {
        throw AppError.badRequest('A Story can only be a screenshot (image) or a screen recording (video).');
      }
      const pc = await prisma.publishedContent.findUnique({
        where: { id: input.target.publishedContentId },
        select: { brandId: true, influencerId: true },
      });
      if (!pc) throw AppError.notFound('Content');
      const brandScope = await scopedBrandIds(ctx);
      if (pc.brandId && isBrandOutOfScope(brandScope, pc.brandId)) throw AppError.notFound('Content');
      if (pc.influencerId) {
        const countryScope = await scopedCountryCodes(ctx);
        if (countryScope) {
          const influencer = await prisma.influencer.findUnique({ where: { id: pc.influencerId }, select: { countryCode: true } });
          if (isCountryOutOfScope(countryScope, influencer?.countryCode ?? null)) throw AppError.notFound('Content');
        }
      }
    } else {
      const { campaignId, influencerId } = await resolveTargetContext(input.target);
      if (campaignId) {
        // Capability grants WHAT; brand scope grants WHERE — both required.
        await requireAnyCapability(ctx, ['CAMPAIGNS_MANAGE', 'INFLUENCERS_MANAGE']);
        await makeCampaignService(ctx).assertInScope(campaignId);
        // A roster row also carries its creator's country scope.
        if (influencerId && (await influencerOutOfCountryScope(influencerId))) throw AppError.notFound('Influencer');
      } else if (influencerId) {
        await requireCapability(ctx, 'INFLUENCERS_MANAGE');
        const influencer = await prisma.influencer.findUnique({
          where: { id: influencerId },
          select: { countryCode: true },
        });
        const countryScope = await scopedCountryCodes(ctx);
        if (!influencer || isCountryOutOfScope(countryScope, influencer.countryCode)) {
          throw AppError.notFound('Influencer');
        }
      } else {
        // Residual target types this service can't cleanly resolve to a
        // campaign or influencer (see resolveTargetContext's doc comment) —
        // least-surprising fix: still require SOME manage capability rather
        // than leave this open to every logged-in actor, without guessing at
        // note.service.ts's own brand/country/channel authorization rules for
        // those contexts.
        await requireAnyCapability(ctx, ['CAMPAIGNS_MANAGE', 'INFLUENCERS_MANAGE']);
      }
    }

    const storageKey = buildStorageKey(scope, fileName);
    const ticket = await signUploadTicket({
      storageKey,
      fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      kind,
      actorId: actor.id,
      target: {
        campaignId: input.target.campaignId ?? null,
        deliverableId: input.target.deliverableId ?? null,
        scriptReferenceId: input.target.scriptReferenceId ?? null,
        influencerId: input.target.influencerId ?? null,
        noteId: input.target.noteId ?? null,
        publishedContentId: input.target.publishedContentId ?? null,
        campaignInfluencerId: input.target.campaignInfluencerId ?? null,
      },
    });

    const presignedPut = await storage.presignPut(storageKey, input.mimeType, 900, input.sizeBytes);
    return {
      uploadToken: ticket,
      uploadUrl: presignedPut ?? `/api/v1/files/blob?token=${encodeURIComponent(ticket)}`,
      method: 'PUT',
      direct: Boolean(presignedPut),
      headers: presignedPut ? { 'Content-Type': input.mimeType } : {},
      maxBytes: maxUploadBytes(),
    };
  }

  /**
   * Local-driver upload proxy: verify the ticket, enforce the declared size,
   * and persist to private storage. S3 clients never hit this path.
   */
  async function writeBlob(token: string, body: Buffer): Promise<void> {
    const ticket = await verifyUploadTicket(token);
    // A creator's task-link upload goes through its own address (creator-link.service).
    if (ticket.target.creatorLinkId) throw AppError.badRequest('This upload/download link is invalid or has expired.');
    if (body.length === 0) throw AppError.badRequest('The uploaded file is empty.');
    if (body.length > maxUploadBytes()) throw AppError.badRequest('File exceeds the maximum allowed size.');
    await storage.save(ticket.storageKey, body, ticket.mimeType);
  }

  /**
   * Phase 2 — confirm the object landed in storage and create the attachment
   * record. The size is re-checked against the actual stored object so a
   * client cannot under-declare in phase 1 and upload something larger.
   */
  async function complete(token: string): Promise<AttachmentDTO> {
    const ticket = await verifyUploadTicket(token);
    if (ticket.target.creatorLinkId) throw AppError.badRequest('This upload/download link is invalid or has expired.');

    // Idempotent (WK-05): a replayed completion for the same storage key returns
    // the already-created attachment instead of inserting a duplicate row (the
    // `storageKey` unique constraint also enforces this at the database).
    const already = await prisma.attachment.findUnique({ where: { storageKey: ticket.storageKey }, select: selectRow });
    if (already) return toDTO(already);

    const head = await storage.head(ticket.storageKey);
    if (!head) throw AppError.badRequest('Upload was not found in storage. Please retry the upload.');
    if (head.size > maxUploadBytes()) {
      await storage.remove(ticket.storageKey).catch(() => undefined);
      throw AppError.badRequest('Uploaded object exceeds the maximum allowed size.');
    }

    let row: Row;
    try {
      row = await prisma.attachment.create({
        data: {
          fileName: ticket.fileName.slice(0, 200),
          mimeType: ticket.mimeType,
          sizeBytes: head.size,
          storageKey: ticket.storageKey,
          kind: ticket.kind,
          campaignId: ticket.target.campaignId ?? null,
          deliverableId: ticket.target.deliverableId ?? null,
          scriptReferenceId: ticket.target.scriptReferenceId ?? null,
          influencerId: ticket.target.influencerId ?? null,
          noteId: ticket.target.noteId ?? null,
          publishedContentId: ticket.target.publishedContentId ?? null,
          campaignInfluencerId: ticket.target.campaignInfluencerId ?? null,
          uploadedById: ticket.actorId,
        },
        select: selectRow,
      });
    } catch (err) {
      // A concurrent completion won the race — return that single row, still idempotent.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await prisma.attachment.findUnique({ where: { storageKey: ticket.storageKey }, select: selectRow });
        if (existing) return toDTO(existing);
      }
      throw err;
    }

    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${ctx.actor?.name ?? 'Someone'} uploaded ${ticket.fileName}.`,
      campaignId: ticket.target.campaignId ?? null,
      influencerId: ticket.target.influencerId ?? null,
      deliverableId: ticket.target.deliverableId ?? null,
    });

    return toDTO(row);
  }

  async function list(target: Target): Promise<AttachmentDTO[]> {
    const { where } = scopeFor(target);
    await assertReadScope(target);
    const rows = await prisma.attachment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: selectRow,
    });
    return Promise.all(rows.map(toDTO));
  }

  async function get(id: string): Promise<AttachmentDTO> {
    const row = await prisma.attachment.findUnique({ where: { id }, select: selectRow });
    if (!row) throw AppError.notFound('Attachment');
    await assertReadScope(targetOf(row)).catch(() => {
      throw AppError.notFound('Attachment');
    });
    return toDTO(row);
  }

  /**
   * Local-driver download proxy: verify the signed download ticket, then
   * stream bytes. The signed token is the capability — no session required —
   * so the URL works in an <img>/<a> tag but expires quickly.
   */
  async function readBlobSigned(id: string, token: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const ticket = await verifyDownloadTicket(token);
    if (ticket.attachmentId !== id) throw AppError.badRequest('This download link is invalid.');
    const row = await prisma.attachment.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('Attachment');
    const buffer = await storage.read(row.storageKey);
    if (!buffer) throw AppError.notFound('File');
    return { buffer, mimeType: row.mimeType, fileName: row.fileName };
  }

  async function remove(id: string): Promise<void> {
    const row = await prisma.attachment.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('Attachment');
    // Least privilege (SEC-04): only the uploader or an ADMIN may delete a file.
    requireOwnerOrAdmin(ctx, row.uploadedById, 'file');
    await storage.remove(row.storageKey).catch(() => undefined);
    await prisma.attachment.delete({ where: { id } });
  }

  /** The admin kill switch, created on first use so it shows up in the Flags tab. */
  async function cleanupFlagEnabled(): Promise<boolean> {
    const where = { key: CLEANUP_FLAG, scope: 'PLATFORM' as const, brandId: null };
    const flag = await prisma.featureFlag.findFirst({ where });
    if (flag) return flag.enabled;
    await prisma.featureFlag
      .create({
        data: {
          ...where,
          enabled: true,
          description:
            'Move stored files that no record points at into quarantine (deleted after 30 days). Turn off while restoring a backup.',
        },
      })
      .catch(() => undefined);
    return true;
  }

  /**
   * Move stored files that no Attachment row references (uploads that were
   * never completed, or files whose record was deleted) into `quarantine/`,
   * and purge quarantined files once they are CLEANUP_QUARANTINE_DAYS old.
   *
   * Built to fail safe, because the input is "every file the database does
   * not know about" — pointed at an empty, restored or wrong database, that is
   * every file:
   *  - The `file_cleanup` flag (Settings → Platform → Flags) or
   *    CLEANUP_ENABLED=false turns it off entirely (use during a restore).
   *  - It refuses to run when the Attachment table is empty but files exist,
   *    or when the orphans are both numerous and a large share of all files.
   *  - Nothing is deleted on the spot; a quarantined file whose record comes
   *    back (e.g. after a database restore) is moved back automatically.
   */
  async function cleanupAbandonedUploads(olderThanMs = 24 * 60 * 60 * 1000): Promise<UploadCleanupResult> {
    const result: UploadCleanupResult = { quarantined: 0, restored: 0, purged: 0, orphans: 0, skipped: null };
    if (process.env.CLEANUP_ENABLED === 'false' || !(await cleanupFlagEnabled())) {
      return { ...result, skipped: 'disabled' };
    }

    const objects = await storage.list(LIVE_PREFIX);
    const quarantined = await storage.list(QUARANTINE_PREFIX);
    if (objects.length === 0 && quarantined.length === 0) return result;

    // The set of keys that are legitimately referenced by an Attachment row.
    const known = new Set(
      (await prisma.attachment.findMany({ select: { storageKey: true } })).map((r) => r.storageKey),
    );

    // A record that points at a quarantined file (restored database, or a
    // record re-created after its file was quarantined) gets its file back.
    const live = new Set(objects.map((o) => o.key));
    for (const q of quarantined) {
      const original = q.key.slice(QUARANTINE_PREFIX.length);
      if (!known.has(original) || live.has(original)) continue;
      try {
        await storage.copy(q.key, original);
        await storage.remove(q.key);
        result.restored += 1;
      } catch {
        /* retried next run */
      }
    }

    // Only files old enough to be certainly abandoned. If the age is unknown,
    // leave it (never touch a possibly-live upload).
    const cutoff = Date.now() - olderThanMs;
    const orphans = objects.filter(
      (o) => !known.has(o.key) && o.lastModified != null && o.lastModified.getTime() <= cutoff,
    );
    result.orphans = orphans.length;

    if (orphans.length > 0 && known.size === 0) {
      result.skipped = 'no-attachment-records';
    } else if (
      orphans.length > (Number(process.env.CLEANUP_MAX_ORPHANS) || 200) &&
      orphans.length > objects.length * 0.25
    ) {
      result.skipped = 'too-many-orphans';
    } else {
      for (const obj of orphans) {
        try {
          await storage.copy(obj.key, QUARANTINE_PREFIX + obj.key);
          await storage.remove(obj.key);
          result.quarantined += 1;
        } catch {
          /* left in place; retried next run */
        }
      }
    }

    // Quarantine expiry runs even when the orphan pass was skipped — it never
    // depends on the database, only on how long a file has sat in quarantine.
    const keepDays = Number(process.env.CLEANUP_QUARANTINE_DAYS) || 30;
    const expiry = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    for (const q of quarantined) {
      const original = q.key.slice(QUARANTINE_PREFIX.length);
      if (known.has(original) || !q.lastModified || q.lastModified.getTime() > expiry) continue;
      await storage.remove(q.key).then(
        () => (result.purged += 1),
        () => undefined,
      );
    }
    return result;
  }

  return {
    initiate,
    writeBlob,
    complete,
    list,
    get,
    readBlobSigned,
    remove,
    cleanupAbandonedUploads,
    maxUploadBytes,
  };
}

export type AttachmentService = ReturnType<typeof makeAttachmentService>;
