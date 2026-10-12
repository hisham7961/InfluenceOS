import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { AppError } from '../errors';

/**
 * Time-limited, HMAC-signed capability tokens for object storage. Used by the
 * two-phase upload flow (upload tickets, 15 minutes) and by the app's
 * download links (one to two hours, so browsers can cache them). These are
 * NOT user sessions — they authorize a single storage operation on a single
 * key and always carry an expiry, so a leaked URL grants only time-limited
 * access to one object.
 */

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new AppError('INTERNAL', 'AUTH_SECRET is not configured.');
  }
  return new TextEncoder().encode(s);
}

const ISSUER = 'influenceos:storage';

async function sign(
  payload: JWTPayload,
  purpose: string,
  ttlSeconds: number,
  window?: { issuedAt: number; expiresAt: number },
): Promise<string> {
  const jwt = new SignJWT({ ...payload, purpose }).setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER);
  return (window
    ? jwt.setIssuedAt(window.issuedAt).setExpirationTime(window.expiresAt)
    : jwt.setIssuedAt().setExpirationTime(`${ttlSeconds}s`)
  ).sign(secret());
}

async function verify<T extends JWTPayload>(token: string, purpose: string): Promise<T> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER });
    if (payload.purpose !== purpose) throw new Error('purpose mismatch');
    return payload as T;
  } catch {
    throw AppError.badRequest('This upload/download link is invalid or has expired.');
  }
}

export interface UploadTicket extends JWTPayload {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: string;
  actorId: string;
  target: Record<string, string | null>;
}

export function signUploadTicket(ticket: Omit<UploadTicket, 'purpose'>, ttlSeconds = 900): Promise<string> {
  return sign(ticket, 'upload', ttlSeconds);
}

export function verifyUploadTicket(token: string): Promise<UploadTicket> {
  return verify<UploadTicket>(token, 'upload');
}

export interface DownloadTicket extends JWTPayload {
  attachmentId: string;
}

/**
 * A download link's token. With `stable`, the token is the same for every
 * call within one `stable`-second window (issued at the window's start,
 * expiring one window after it ends, so it always works for at least a
 * window) — the link a page shows doesn't change on every refresh, and the
 * browser can cache what it points at.
 */
export function signDownloadTicket(
  attachmentId: string,
  ttlSeconds = 600,
  opts: { stable?: number; now?: number } = {},
): Promise<string> {
  if (opts.stable && opts.stable > 0) {
    const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
    const issuedAt = nowSec - (nowSec % opts.stable);
    return sign({ attachmentId }, 'download', ttlSeconds, { issuedAt, expiresAt: issuedAt + 2 * opts.stable });
  }
  return sign({ attachmentId }, 'download', ttlSeconds);
}

export function verifyDownloadTicket(token: string): Promise<DownloadTicket> {
  return verify<DownloadTicket>(token, 'download');
}
