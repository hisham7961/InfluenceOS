import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Storage abstraction with two interchangeable drivers:
 *  - `s3`    : S3-compatible object storage (MinIO in dev, S3/R2/etc. in prod).
 *              Uploads use presigned PUT URLs; downloads use presigned GET URLs.
 *              The bucket is PRIVATE — objects are never publicly readable.
 *  - `local` : local disk under an uploads dir. Uploads go through a
 *              signed-token API endpoint; downloads through a signed-token proxy.
 *              This is the default so the product works with no object store.
 *
 * Select with STORAGE_DRIVER=s3|local (default local). Neither driver ever
 * exposes objects publicly; both require server-minted, expiring signed access.
 */

export interface StorageDriver {
  readonly name: 's3' | 'local';
  /** Whether the driver can hand the client a direct presigned PUT URL. */
  readonly presignedUpload: boolean;
  /** Presigned PUT URL for direct-to-storage upload (s3), else null (local). */
  presignPut(key: string, contentType: string, expiresIn: number): Promise<string | null>;
  /** Presigned GET URL for direct download (s3), else null (local proxy). */
  presignGet(key: string, fileName: string, expiresIn: number): Promise<string | null>;
  /** Server-side write (local upload proxy path). */
  save(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Confirm an object exists and its size, or null. */
  head(key: string): Promise<{ size: number } | null>;
  /** Read bytes (local download proxy). */
  read(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
  /** List objects under a key prefix (for orphan/abandoned-upload cleanup). */
  list(prefix: string): Promise<StoredObject[]>;
}

export interface StoredObject {
  key: string;
  lastModified: Date | null;
}

class S3Driver implements StorageDriver {
  readonly name = 's3' as const;
  readonly presignedUpload = true;
  /** Used for server-side operations (API/worker → storage). */
  private client: S3Client;
  /** Used ONLY to construct presigned URLs the browser will call. Its endpoint
   *  is the browser-reachable origin, which in a containerized deployment
   *  differs from the internal service DNS name. */
  private presignClient: S3Client;
  private bucket: string;

  constructor(env: NodeJS.ProcessEnv) {
    this.bucket = env.S3_BUCKET ?? 'influenceos';
    // Internal endpoint: how the API/worker reach storage. Falls back to the
    // legacy S3_ENDPOINT for backward compatibility.
    const internalEndpoint = env.S3_INTERNAL_ENDPOINT ?? env.S3_ENDPOINT;
    // Browser-facing endpoint used only for signing. Falls back to the internal
    // one for single-host setups where they are the same.
    const presignEndpoint = env.S3_PUBLIC_ENDPOINT ?? env.S3_PRESIGN_ENDPOINT ?? internalEndpoint;

    const common = {
      region: env.S3_REGION ?? 'us-east-1',
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    } as const;

    this.client = new S3Client({ ...common, endpoint: internalEndpoint });
    this.presignClient = new S3Client({ ...common, endpoint: presignEndpoint });
  }

  presignPut(key: string, contentType: string, expiresIn: number): Promise<string | null> {
    return getSignedUrl(
      this.presignClient,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
  }

  presignGet(key: string, fileName: string, expiresIn: number): Promise<string | null> {
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

  async read(): Promise<Buffer | null> {
    return null; // S3 downloads use presigned GET, not the proxy.
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
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

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
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
