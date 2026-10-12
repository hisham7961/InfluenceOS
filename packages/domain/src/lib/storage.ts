import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { signDownloadTicket } from './tokens';

/**
 * Storage abstraction with two interchangeable drivers:
 *  - `s3`    : S3-compatible object storage (MinIO in dev, S3/R2/etc. in prod).
 *              The bucket is PRIVATE — objects are never publicly readable.
 *  - `local` : local disk under an uploads dir.
 *              This is the default so the product works with no object store.
 *
 * Select with STORAGE_DRIVER=s3|local (default local). Neither driver ever
 * exposes objects publicly; both require server-minted, expiring signed access.
 *
 * How browsers reach the bytes (S3_BROWSER_ACCESS, s3 only):
 *  - `proxy` (default): uploads and downloads go through the app's own
 *    address — the browser sends the file to the API (signed upload ticket),
 *    the API writes it to the store over the private network, and downloads
 *    stream back the same way (signed link, byte ranges for video). Nothing
 *    about the store has to be reachable from the internet: no files domain,
 *    no CORS, no mixed content, no CSP entry. The local driver always works
 *    this way.
 *  - `direct`: the browser PUTs/GETs presigned URLs on S3_PUBLIC_ENDPOINT.
 *    Only for a store that is really served to browsers over HTTPS (a files
 *    domain in front of MinIO, or S3/R2 with CORS for the app's origin).
 */

export type BrowserAccess = 'proxy' | 'direct';

/** How browsers reach stored bytes — see the comment above. */
export function browserAccess(env: NodeJS.ProcessEnv = process.env): BrowserAccess {
  if ((env.STORAGE_DRIVER ?? 'local').toLowerCase() !== 's3') return 'proxy';
  return (env.S3_BROWSER_ACCESS ?? '').trim().toLowerCase() === 'direct' ? 'direct' : 'proxy';
}

/** An inclusive byte range of a stored object. */
export interface ByteRange {
  start: number;
  end: number;
}

export interface StorageDriver {
  readonly name: 's3' | 'local';
  /** Whether the driver hands the client a direct presigned PUT URL (s3 in
   *  `direct` browser access), rather than the API's upload address. */
  readonly presignedUpload: boolean;
  /** Presigned PUT URL for direct-to-storage upload (s3 `direct`), else null
   *  (the upload goes through the API). When `contentLength` is given it is
   *  baked into the signature, so S3 rejects any upload whose byte length
   *  differs from the (server-validated) declared size (WK-01). */
  presignPut(key: string, contentType: string, expiresIn: number, contentLength?: number): Promise<string | null>;
  /** Presigned GET URL for direct download (s3 `direct`), else null (the
   *  download streams through the API's signed link). */
  presignGet(key: string, fileName: string, expiresIn: number): Promise<string | null>;
  /** Server-side write (the API's upload address, covers). */
  save(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Confirm an object exists and its size, or null. */
  head(key: string): Promise<{ size: number } | null>;
  /** Read bytes server-side (AI screenshot reading, covers). */
  read(key: string): Promise<Buffer | null>;
  /** Stream an object — whole, or one inclusive byte range — for the API's
   *  download link; null when the object isn't there. */
  openRead(key: string, range?: ByteRange): Promise<Readable | null>;
  remove(key: string): Promise<void>;
  /** Server-side copy (used to quarantine orphaned files instead of deleting them). */
  copy(fromKey: string, toKey: string): Promise<void>;
  /** List objects under a key prefix (for orphan/abandoned-upload cleanup). */
  list(prefix: string): Promise<StoredObject[]>;
  /** Make sure the private bucket (s3) or upload dir (local) exists. */
  ensureReady(): Promise<'exists' | 'created'>;
}

export interface StoredObject {
  key: string;
  lastModified: Date | null;
}

/** True when an S3 error means "no such object". */
function isMissing(err: unknown): boolean {
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  const name = (err as { name?: string }).name;
  return status === 404 || name === 'NoSuchKey' || name === 'NotFound';
}

/** Downloads streamed to browsers: how long a storage connection may sit
 *  idle (the viewer stopped reading) and how many may be open at once. */
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
const DOWNLOAD_MAX_SOCKETS = 100;

/**
 * Close a stream from storage once no bytes have moved for `ms` — the reader
 * stopped reading, so the connection under it would otherwise stay taken.
 * A steady reader, however slow, is never cut off. (The SDK's own
 * requestTimeout only covers the wait for the response headers.)
 */
export function closeWhenIdle<T extends Readable>(body: T, ms: number): T {
  const http = body as T & { setTimeout?: (ms: number, cb: () => void) => unknown };
  if (typeof http.setTimeout === 'function') {
    http.setTimeout(ms, () => body.destroy(new Error(`Storage read idle for ${ms} ms.`)));
  }
  return body;
}

class S3Driver implements StorageDriver {
  readonly name = 's3' as const;
  readonly presignedUpload: boolean;
  /** Whether browsers are handed presigned URLs (`direct`) or go through the API (`proxy`). */
  private direct: boolean;
  /** Used for server-side operations (API/worker → storage). */
  private client: S3Client;
  /** Streams downloads to browsers (openRead). Its own connections, so slow
   *  or stalled viewers can never use up the ones uploads and the rest need;
   *  a connection a viewer has stopped reading from is closed after a minute
   *  (a video player simply asks again for the range it needs). */
  private readClient: S3Client;
  /** Used ONLY to construct presigned URLs the browser will call. Its endpoint
   *  is the browser-reachable origin, which in a containerized deployment
   *  differs from the internal service DNS name. */
  private presignClient: S3Client;
  private bucket: string;

  constructor(env: NodeJS.ProcessEnv) {
    this.direct = browserAccess(env) === 'direct';
    this.presignedUpload = this.direct;
    this.bucket = env.S3_BUCKET ?? 'influenceos';
    // Internal endpoint: how the API/worker reach storage. Falls back to the
    // legacy S3_ENDPOINT for backward compatibility.
    const internalEndpoint = env.S3_INTERNAL_ENDPOINT || env.S3_ENDPOINT;
    // Browser-facing endpoint used only for signing (`direct` access). Falls
    // back to the internal one for single-host setups where they are the
    // same. Empty values (an unset compose variable) count as unset.
    const presignEndpoint = env.S3_PUBLIC_ENDPOINT || env.S3_PRESIGN_ENDPOINT || internalEndpoint;

    const common = {
      region: env.S3_REGION ?? 'us-east-1',
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    } as const;

    this.client = new S3Client({ ...common, endpoint: internalEndpoint });
    this.readClient = new S3Client({
      ...common,
      endpoint: internalEndpoint,
      requestHandler: {
        requestTimeout: DOWNLOAD_IDLE_TIMEOUT_MS,
        httpAgent: { maxSockets: DOWNLOAD_MAX_SOCKETS },
        httpsAgent: { maxSockets: DOWNLOAD_MAX_SOCKETS },
      },
    });
    this.presignClient = new S3Client({ ...common, endpoint: presignEndpoint });
  }

  async presignPut(key: string, contentType: string, expiresIn: number, contentLength?: number): Promise<string | null> {
    if (!this.direct) return null; // the browser sends the bytes to the API instead
    return getSignedUrl(
      this.presignClient,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        // Baking the exact byte length into the signature makes S3 reject an
        // upload that isn't exactly the (already ≤max, server-validated) size.
        ...(contentLength != null ? { ContentLength: contentLength } : {}),
      }),
      { expiresIn },
    );
  }

  async presignGet(key: string, fileName: string, expiresIn: number): Promise<string | null> {
    if (!this.direct) return null; // the browser downloads through the API's signed link
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
      }),
      { expiresIn },
    );
  }

  async save(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  /** Server-side read (AI screenshot reading, covers). */
  async read(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async openRead(key: string, range?: ByteRange): Promise<Readable | null> {
    try {
      const res = await this.readClient.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        }),
      );
      // In Node the SDK's body is the HTTP response stream itself.
      const body = res.Body as Readable | undefined;
      return body ? closeWhenIdle(body, DOWNLOAD_IDLE_TIMEOUT_MS) : null;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: toKey,
        // CopySource is "<bucket>/<key>" with the key URL-encoded per segment.
        CopySource: `${this.bucket}/${fromKey.split('/').map(encodeURIComponent).join('/')}`,
      }),
    );
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) {
        if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified ?? null });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  // A fresh object store (new server, restored volume, compose variant with
  // no minio-setup job) has no bucket, and every upload would fail. Created
  // private: no bucket policy is ever attached.
  async ensureReady(): Promise<'exists' | 'created'> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return 'exists';
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404) throw err;
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') return 'exists';
      throw err;
    }
    return 'created';
  }
}

class LocalDriver implements StorageDriver {
  readonly name = 'local' as const;
  readonly presignedUpload = false;
  private baseDir: string;

  constructor(env: NodeJS.ProcessEnv) {
    this.baseDir = resolve(env.LOCAL_UPLOAD_DIR ?? join(process.cwd(), 'uploads'));
  }

  private pathFor(key: string): string {
    // Defensive: keys are server-generated, but block traversal regardless.
    const safe = key.replace(/\.\.(\/|\\|$)/g, '').replace(/^[/\\]+/, '');
    return join(this.baseDir, safe);
  }

  async presignPut(): Promise<string | null> {
    return null; // local uploads go through the signed API endpoint
  }
  async presignGet(): Promise<string | null> {
    return null; // local downloads go through the signed API proxy
  }

  async save(key: string, body: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const s = await stat(this.pathFor(key));
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  async openRead(key: string, range?: ByteRange): Promise<Readable | null> {
    const p = this.pathFor(key);
    const exists = await stat(p).then(
      (st) => st.isFile(),
      () => false,
    );
    if (!exists) return null;
    return createReadStream(p, range ? { start: range.start, end: range.end } : undefined);
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    const to = this.pathFor(toKey);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(this.pathFor(fromKey), to);
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const root = this.pathFor(prefix);
    const out: StoredObject[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // prefix dir doesn't exist yet
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else {
          const s = await stat(full).catch(() => null);
          out.push({ key: full.slice(this.baseDir.length + 1), lastModified: s?.mtime ?? null });
        }
      }
    };
    await walk(root);
    return out;
  }

  async ensureReady(): Promise<'exists' | 'created'> {
    const existed = await stat(this.baseDir).then(
      () => true,
      () => false,
    );
    await mkdir(this.baseDir, { recursive: true });
    return existed ? 'exists' : 'created';
  }
}

let cached: StorageDriver | null = null;

export function getStorage(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  if (cached) return cached;
  const driver = (env.STORAGE_DRIVER ?? 'local').toLowerCase();
  cached = driver === 's3' ? new S3Driver(env) : new LocalDriver(env);
  return cached;
}

/** Reset the cached driver (tests). */
export function resetStorage(): void {
  cached = null;
}

/** Sanitize a filename to a safe, bounded, path-free string. */
export function sanitizeFileName(name: string): string {
  return (
    name
      .split(/[/\\]/)
      .pop()!
      .replace(/[^a-zA-Z0-9.\-_ ]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180) || 'file'
  );
}

/** Collision-free, path-safe storage key. */
export function buildStorageKey(scope: string, fileName: string): string {
  const safe = sanitizeFileName(fileName).toLowerCase().replace(/[^a-z0-9.\-_]+/g, '-');
  return `attachments/${scope}/${randomUUID()}-${safe}`.slice(0, 300);
}

/** Build an expiring, capability-scoped download URL for an Attachment (never
 *  a public URL) — shared by attachment.service.ts's own AttachmentDTO
 *  mapping and content.service.ts's Story media resolution, so both derive
 *  it the exact same way instead of two parallel signing implementations.
 *
 *  The API's own link stays the same for an hour and works for one to two
 *  hours (signDownloadTicket's `stable`), so a page that refreshes its data
 *  — the Live Content wall every minute — keeps hitting the browser's cache
 *  instead of downloading every image again. */
export async function resolveAttachmentDownloadUrl(
  id: string,
  storageKey: string,
  fileName: string,
  ttlSeconds = 600,
): Promise<string> {
  const storage = getStorage();
  const presigned = await storage.presignGet(storageKey, fileName, ttlSeconds);
  if (presigned) return presigned; // absolute presigned S3 GET (`direct` access)
  const token = await signDownloadTicket(id, ttlSeconds, { stable: DOWNLOAD_LINK_BUCKET_SECONDS });
  return `/api/v1/files/${id}/blob?token=${encodeURIComponent(token)}`;
}

/** The API download link changes once per this many seconds (see above). */
export const DOWNLOAD_LINK_BUCKET_SECONDS = 3600;

/**
 * The part of an object a `Range` header asks for, against its full size:
 * null for the whole object (no header, a header we don't serve — several
 * ranges, another unit — or nothing to slice), 'unsatisfiable' for a range
 * entirely past the end (HTTP 416).
 */
export function parseByteRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header || size <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multiple ranges or another unit: send the whole object
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  if (a === '') {
    // Suffix: the last N bytes.
    const n = Number(b);
    if (n === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (start >= size) return 'unsatisfiable';
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (end < start) return null;
  return { start, end };
}
