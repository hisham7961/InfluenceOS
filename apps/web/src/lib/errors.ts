import { ApiError } from '@influenceos/api-client';
import { UploadError } from './upload-error';

/**
 * One way to turn a failed request into the sentence shown to the user
 * (P2.5): the server's message in the viewer's language, and for a form the
 * server rejected, what was wrong with the first field. Anything that isn't
 * an API error but carries a message (e.g. a check the form made itself,
 * already translated) is shown as is.
 *
 * The translator is registered once by <ServerTextBridge/> inside the
 * language provider, so plain functions (mutation onError handlers) can use
 * it without a hook.
 */
let translate: (text: string) => string = (text) => text;
/** The viewer-language sentences for a failed upload (common.uploadError.*). */
let uploadText: (reason: UploadError['reason']) => string = (reason) =>
  reason === 'network'
    ? 'The upload was interrupted. Check your connection and try again.'
    : reason === 'rejected'
      ? "The file couldn't be uploaded — it may be too big or a type that isn't allowed."
      : 'The upload failed on the server. Please try again in a moment.';

export function setServerTextTranslator(fn: (text: string) => string): void {
  translate = fn;
}

export function setUploadErrorText(fn: (reason: UploadError['reason']) => string): void {
  uploadText = fn;
}

export function serverText(text: string): string {
  return translate(text);
}

export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof UploadError) {
    // The server's own reason (too big, type not allowed, link expired) when
    // it gave one; otherwise what happened, in the viewer's language.
    return e.serverMessage ? translate(e.serverMessage) : uploadText(e.reason);
  }
  if (e instanceof ApiError) {
    const message = translate(e.message);
    const field = e.fieldErrors?.find((f) => f.message)?.message;
    if (e.code === 'VALIDATION_ERROR' && field) return `${message} ${translate(field)}`;
    return message || fallback;
  }
  // A network failure (fetch's TypeError) gets the caller's friendly fallback.
  if (e instanceof Error && e.message && !(e instanceof TypeError)) return e.message;
  return fallback;
}
