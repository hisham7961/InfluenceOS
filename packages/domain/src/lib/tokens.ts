import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { AppError } from '../errors';

/**
 * Short-lived, HMAC-signed capability tokens for object storage. Used by the
 * two-phase upload flow (upload tickets) and by the local download proxy
 * (signed download URLs). These are NOT user sessions — they authorize a
 * single storage operation on a single key and always carry an expiry, so a
 * leaked URL grants only brief, scoped access to one object.
 */

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new AppError('INTERNAL', 'AUTH_SECRET is not configured.');
  }
  return new TextEncoder().encode(s);
}

const ISSUER = 'influenceos:storage';

async function sign(payload: JWTPayload, purpose: string, ttlSeconds: number): Promise<string> {
  return new SignJWT({ ...payload, purpose })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret());
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

export function signDownloadTicket(attachmentId: string, ttlSeconds = 600): Promise<string> {
  return sign({ attachmentId }, 'download', ttlSeconds);
}

export function verifyDownloadTicket(token: string): Promise<DownloadTicket> {
  return verify<DownloadTicket>(token, 'download');
}
