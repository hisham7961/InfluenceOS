'use client';

import type { AttachmentDTO, AttachmentTarget, UploadTicketDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { toBrowserUrl } from '@/lib/browser-url';

export { toBrowserUrl };

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

function putBytes(
  url: string,
  file: File,
  ticket: UploadTicketDTO,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    // Direct S3 uploads use the ticket's headers (Content-Type); the local
    // proxy expects raw octet-stream and reads the token from the query string.
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
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Upload failed — network error.'));
    xhr.send(file);
  });
}
