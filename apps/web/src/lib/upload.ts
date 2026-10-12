'use client';

import type { AttachmentDTO, AttachmentTarget, UploadTicketDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { toBrowserUrl } from '@/lib/browser-url';
import { UploadError } from '@/lib/upload-error';

export { toBrowserUrl, UploadError };

/**
 * Two-phase signed upload from the browser:
 *   1. initiate → signed ticket (validates MIME/size server-side)
 *   2. PUT bytes (direct to S3, or via the BFF proxy for the local driver),
 *      reporting progress through XHR
 *   3. complete → the created attachment record
 */
export async function uploadAttachment(
  file: File,
  target: AttachmentTarget,
  onProgress?: (fraction: number) => void,
): Promise<AttachmentDTO> {
  const ticket: UploadTicketDTO = await api.files.initiate({
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    target,
  });

  const putUrl = ticket.direct ? ticket.uploadUrl : toBrowserUrl(ticket.uploadUrl);
  await putBytes(putUrl, file, ticket, onProgress);

  return api.files.complete(ticket.uploadToken);
}

/**
 * A creator's draft file from their task link (no account): ask where to
 * send it, send the bytes, and return the upload token the draft is sent with.
 */
export async function uploadCreatorDraftFile(
  token: string,
  deliverableId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const ticket = await api.creatorLinks.startUpload(token, deliverableId, {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  });
  const putUrl = ticket.direct ? ticket.uploadUrl : toBrowserUrl(ticket.uploadUrl);
  await putBytes(putUrl, file, ticket, onProgress);
  return ticket.uploadToken;
}

/** The API's error message from an error body, if it is one. */
function serverMessageOf(xhr: XMLHttpRequest): string | null {
  try {
    const body = JSON.parse(xhr.responseText) as { error?: { message?: unknown } };
    return typeof body.error?.message === 'string' ? body.error.message : null;
  } catch {
    return null;
  }
}

/** Answers from a proxy or server on the way rather than from the app. */
const INTERRUPTED = new Set([408, 502, 503, 504]);

function putOnce(
  url: string,
  file: File,
  ticket: UploadTicketDTO,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    // Direct S3 uploads use the ticket's headers (Content-Type); the app's
    // upload address expects raw octet-stream and reads the token from the
    // query string.
    if (ticket.direct) {
      for (const [k, v] of Object.entries(ticket.headers)) xhr.setRequestHeader(k, v);
    } else {
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.withCredentials = true;
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      const message = serverMessageOf(xhr);
      // A proxy or server on the way gave up (timed out, restarting): the
      // connection, not the file — the same as a dropped one.
      if (!message && INTERRUPTED.has(xhr.status))
        return reject(new UploadError('network', xhr.status));
      reject(
        new UploadError(
          xhr.status >= 400 && xhr.status < 500 ? 'rejected' : 'failed',
          xhr.status,
          message,
        ),
      );
    };
    xhr.onerror = () => reject(new UploadError('network'));
    xhr.send(file);
  });
}

/**
 * Send the bytes. A dropped connection (a phone switching networks, a
 * moment without signal, a proxy that gave up) is tried once more before
 * giving up — sending the same file to the same place again is harmless.
 * The app's own answer is final.
 */
async function putBytes(
  url: string,
  file: File,
  ticket: UploadTicketDTO,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  try {
    await putOnce(url, file, ticket, onProgress);
  } catch (err) {
    if (!(err instanceof UploadError) || err.reason !== 'network') throw err;
    onProgress?.(0);
    await new Promise((r) => setTimeout(r, 1500));
    await putOnce(url, file, ticket, onProgress);
  }
}
