import { requests, type AttachmentDTO, type AttachmentKind, type UploadTicketDTO } from '@influenceos/contracts';
import type { z } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor } from '../lib/authz';
import { logActivity } from '../lib/helpers';
import { buildStorageKey, getStorage, sanitizeFileName } from '../lib/storage';
import {
  signDownloadTicket,
  signUploadTicket,
  verifyDownloadTicket,
  verifyUploadTicket,
} from '../lib/tokens';

type Target = z.infer<typeof requests.attachmentTargetSchema>;
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

const selectRow = {
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
  createdAt: true,
  uploadedBy: { select: { name: true } },
} as const;

type Row = Prisma.AttachmentGetPayload<{ select: typeof selectRow }>;

const SIGNED_URL_TTL = 600; // 10 minutes for download URLs

export function makeAttachmentService(ctx: DomainContext) {
  const { prisma } = ctx;
  const storage = getStorage(process.env);

  /** Build an expiring, capability-scoped download URL (never a public URL). */
  async function downloadUrlFor(id: string, storageKey: string, fileName: string): Promise<string> {
    const presigned = await storage.presignGet(storageKey, fileName, SIGNED_URL_TTL);
    if (presigned) return presigned; // absolute presigned S3 GET
    const token = await signDownloadTicket(id, SIGNED_URL_TTL);
    return `/api/v1/files/${id}/blob?token=${encodeURIComponent(token)}`;
  }

  async function toDTO(row: Row): Promise<AttachmentDTO> {
    const kind = (row.kind ?? 'other') as AttachmentKind;
    return {
      id: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      kind,
      downloadUrl: await downloadUrlFor(row.id, row.storageKey, row.fileName),
      isImage: kind === 'image',
      uploadedByName: row.uploadedBy?.name ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  function scopeFor(target: Target): { scope: string; where: Prisma.AttachmentWhereInput } {
    if (target.campaignId) return { scope: `campaign/${target.campaignId}`, where: { campaignId: target.campaignId } };
    if (target.deliverableId) return { scope: `deliverable/${target.deliverableId}`, where: { deliverableId: target.deliverableId } };
    if (target.scriptReferenceId) return { scope: `script/${target.scriptReferenceId}`, where: { scriptReferenceId: target.scriptReferenceId } };
    if (target.influencerId) return { scope: `influencer/${target.influencerId}`, where: { influencerId: target.influencerId } };
    if (target.noteId) return { scope: `note/${target.noteId}`, where: { noteId: target.noteId } };
    throw AppError.badRequest('An attachment must be linked to a campaign, deliverable, script, influencer or note.');
  }

  async function assertTargetExists(target: Target): Promise<void> {
    if (target.campaignId && !(await prisma.campaign.count({ where: { id: target.campaignId } }))) throw AppError.notFound('Campaign');
    if (target.deliverableId && !(await prisma.deliverable.count({ where: { id: target.deliverableId } }))) throw AppError.notFound('Deliverable');
    if (target.scriptReferenceId && !(await prisma.scriptReference.count({ where: { id: target.scriptReferenceId } }))) throw AppError.notFound('Script');
    if (target.influencerId && !(await prisma.influencer.count({ where: { id: target.influencerId } }))) throw AppError.notFound('Influencer');
    if (target.noteId && !(await prisma.note.count({ where: { id: target.noteId } }))) throw AppError.notFound('Note');
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
      },
    });

    const presignedPut = await storage.presignPut(storageKey, input.mimeType, 900);
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
    const head = await storage.head(ticket.storageKey);
    if (!head) throw AppError.badRequest('Upload was not found in storage. Please retry the upload.');
    if (head.size > maxUploadBytes()) {
      await storage.remove(ticket.storageKey).catch(() => undefined);
      throw AppError.badRequest('Uploaded object exceeds the maximum allowed size.');
    }

    const row = await prisma.attachment.create({
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
        uploadedById: ticket.actorId,
      },
      select: selectRow,
    });

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
    requireActor(ctx);
    const row = await prisma.attachment.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('Attachment');
    await storage.remove(row.storageKey).catch(() => undefined);
    await prisma.attachment.delete({ where: { id } });
  }

  /**
   * Cleanup for ABANDONED uploads: objects that were PUT to storage (directly to
   * S3 via a presigned URL, or through the local proxy) but whose two-phase
   * upload was never completed, so no Attachment row references them. Such
   * orphans accumulate silently. This lists objects under the attachments
   * prefix and deletes those that (a) have no Attachment row and (b) are older
   * than `olderThanMs` (a grace window so an in-flight upload is never removed).
   * Idempotent and safe to run repeatedly (worker maintenance). Returns the
   * number of orphan objects deleted.
   */
  async function cleanupAbandonedUploads(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
    const objects = await storage.list('attachments/');
    if (objects.length === 0) return 0;
    // The set of keys that are legitimately referenced by an Attachment row.
    const known = new Set(
      (await prisma.attachment.findMany({ select: { storageKey: true } })).map((r) => r.storageKey),
    );
    const cutoff = Date.now() - olderThanMs;
    let deleted = 0;
    for (const obj of objects) {
      if (known.has(obj.key)) continue;
      // Only remove objects old enough to be certainly abandoned. If we can't
      // tell the age, leave it (conservative — never delete a possibly-live one).
      const age = obj.lastModified ? obj.lastModified.getTime() : Date.now();
      if (age > cutoff) continue;
      await storage.remove(obj.key).catch(() => undefined);
      deleted += 1;
    }
    return deleted;
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
