import { ApiError } from '@influenceos/api-client';

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

export function setServerTextTranslator(fn: (text: string) => string): void {
  translate = fn;
}

export function serverText(text: string): string {
  return translate(text);
}

export function errorMessage(e: unknown, fallback: string): string {
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
