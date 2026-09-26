import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolveContentThumbnail, type Platform } from '@influenceos/shared';
import type { PrismaClient } from '@influenceos/database';
import { getStorage, type StorageDriver } from './storage';

/**
 * Post covers kept in our own storage. The cover links Instagram and TikTok
 * hand out are signed CDN URLs that stop working after a few days, so a
 * campaign's posts turned into grey boxes. The worker downloads each cover
 * once — only from the platforms' known image hosts, only real images, only
 * up to a size cap — and keeps it in the private bucket; the app then shows
 * it through GET /api/v1/covers/:id with a signed, day-stable link.
 */

/** The platforms' image hosts. Nothing else is ever fetched. */
const COVER_HOST_SUFFIXES = [
  'cdninstagram.com',
  'fbcdn.net',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokcdn-eu.com',
  'ibyteimg.com',
  'byteimg.com',
  'muscdn.com',
  'ytimg.com',
  'ggpht.com',
  'sc-cdn.net',
  'snapchat.com',
  'twimg.com',
];

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
/** Attempts before the worker gives up on a cover (the platform link stays). */
export const MAX_COVER_TRIES = 3;

export const COVER_PREFIX = 'covers/';

type ImageType = { mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; ext: string };

/** An https URL on one of the platforms' image hosts (no credentials, default port). */
export function isAllowedCoverUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return COVER_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

/** What the bytes are, from their first bytes — never from the server's word. */
export function sniffImage(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (
    buf.length >= 6 &&
    (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')
  ) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  return null;
}

export type CoverFetchResult =
  | { ok: true; body: Buffer; type: ImageType }
  | { ok: false; reason: 'blocked' | 'gone' | 'failed' };

/**
 * Download one cover safely: allowed hosts only (each redirect re-checked),
 * a timeout, a byte cap while reading, and the bytes must be an image.
 * "gone" means the link has expired or been removed (403/404/410).
 */
export async function fetchCover(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CoverFetchResult> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isAllowedCoverUrl(current)) return { ok: false, reason: 'blocked' };
    let res: Response;
    try {
      res = await fetchImpl(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' },
      });
    } catch {
      return { ok: false, reason: 'failed' };
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) return { ok: false, reason: 'failed' };
      current = new URL(next, current).toString();
      continue;
    }
    if (res.status === 403 || res.status === 404 || res.status === 410)
      return { ok: false, reason: 'gone' };
    if (!res.ok || !res.body) return { ok: false, reason: 'failed' };
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return { ok: false, reason: 'blocked' };

    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > MAX_BYTES) return { ok: false, reason: 'blocked' };
        chunks.push(Buffer.from(chunk));
      }
    } catch {
      return { ok: false, reason: 'failed' };
    }
    const body = Buffer.concat(chunks);
    const type = sniffImage(body);
    if (!type) return { ok: false, reason: 'blocked' };
    return { ok: true, body, type };
  }
  return { ok: false, reason: 'failed' };
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** The content type a saved cover is served with (from its key's extension). */
export function coverMimeType(key: string): string {
  return MIME_BY_EXT[key.split('.').pop() ?? ''] ?? 'application/octet-stream';
}

function coverSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET is not configured.');
  return s;
}

function coverSignature(id: string, expires: number): string {
  return createHmac('sha256', coverSecret()).update(`cover:${id}:${expires}`).digest('base64url');
}

/**
 * A link to our copy of a post's cover. It stays the same for a whole day
 * (so browsers cache it) and works for at least a day — long enough for a
 * page, a shared client report or a printed PDF.
 */
export function coverUrl(id: string, now = Date.now()): string {
  const day = 24 * 60 * 60;
  const expires = (Math.floor(now / 1000 / day) + 2) * day;
  return `/api/v1/covers/${id}?e=${expires}&s=${coverSignature(id, expires)}`;
}

/** Whether a cover link is genuine and not yet expired. */
export function verifyCoverLink(
  id: string,
  expires: string | undefined,
  signature: string | undefined,
  now = Date.now(),
): boolean {
  const e = Number(expires);
  if (!Number.isInteger(e) || !signature || e * 1000 < now) return false;
  const want = Buffer.from(coverSignature(id, e));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The cover a post shows: our saved copy when there is one, else the platform's link. */
export function contentThumbnail(pc: {
  id: string;
  thumbnailUrl: string | null;
  coverKey?: string | null;
}): string | null {
  return pc.coverKey ? coverUrl(pc.id) : pc.thumbnailUrl;
}

export interface SaveCoversResult {
  saved: number;
  failed: number;
}

/**
 * Save the covers of the newest posts that don't have one saved yet (worker,
 * every sweep). An expired link is looked up again from the post once; a
 * cover that still can't be saved is retried on later sweeps up to
 * MAX_COVER_TRIES times, and the platform's link keeps showing meanwhile.
 */
export async function saveCovers(
  prisma: PrismaClient,
  limit: number,
  deps: {
    storage?: StorageDriver;
    fetchImpl?: typeof fetch;
    resolveThumbnail?: typeof resolveContentThumbnail;
    /** Only these posts (tests). */
    only?: string[];
  } = {},
): Promise<SaveCoversResult> {
  const storage = deps.storage ?? getStorage();
  const resolve = deps.resolveThumbnail ?? resolveContentThumbnail;
  const rows = await prisma.publishedContent.findMany({
    where: {
      coverKey: null,
      thumbnailUrl: { not: null },
      coverTries: { lt: MAX_COVER_TRIES },
      isStory: false,
      ...(deps.only ? { id: { in: deps.only } } : {}),
    },
    select: { id: true, platform: true, externalId: true, originalUrl: true, thumbnailUrl: true },
    orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  const result: SaveCoversResult = { saved: 0, failed: 0 };
  for (const row of rows) {
    let thumbnailUrl = row.thumbnailUrl!;
    let got = await fetchCover(thumbnailUrl, deps.fetchImpl);
    if (!got.ok && got.reason === 'gone') {
      // The link expired: ask the platform for the post's current cover.
      const fresh = await resolve({
        platform: row.platform as Platform,
        canonicalUrl: row.originalUrl,
        externalId: row.externalId,
        timeoutMs: 4000,
      }).catch(() => null);
      if (fresh && fresh !== thumbnailUrl) {
        thumbnailUrl = fresh;
        got = await fetchCover(fresh, deps.fetchImpl);
      }
    }
    if (!got.ok) {
      await prisma.publishedContent.update({
        where: { id: row.id },
        data: {
          coverTries: { increment: 1 },
          ...(thumbnailUrl !== row.thumbnailUrl ? { thumbnailUrl } : {}),
        },
      });
      result.failed += 1;
      continue;
    }
    const key = `${COVER_PREFIX}${row.id}.${got.type.ext}`;
    try {
      await storage.save(key, got.body, got.type.mime);
    } catch {
      await prisma.publishedContent.update({
        where: { id: row.id },
        data: { coverTries: { increment: 1 } },
      });
      result.failed += 1;
      continue;
    }
    await prisma.publishedContent.update({
      where: { id: row.id },
      data: { coverKey: key, ...(thumbnailUrl !== row.thumbnailUrl ? { thumbnailUrl } : {}) },
    });
    result.saved += 1;
  }
  return result;
}
