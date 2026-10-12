import { afterEach, describe, expect, it } from 'vitest';
import { browserAccess, getStorage, parseByteRange, resetStorage } from '../storage';
import { signDownloadTicket, verifyDownloadTicket } from '../tokens';

describe('how browsers reach stored files', () => {
  afterEach(() => resetStorage());

  it('goes through the app unless direct access is asked for, with s3', () => {
    expect(browserAccess({ STORAGE_DRIVER: 'local' })).toBe('proxy');
    expect(browserAccess({ STORAGE_DRIVER: 'local', S3_BROWSER_ACCESS: 'direct' })).toBe('proxy');
    expect(browserAccess({ STORAGE_DRIVER: 's3' })).toBe('proxy');
    expect(browserAccess({ STORAGE_DRIVER: 's3', S3_BROWSER_ACCESS: '' })).toBe('proxy');
    expect(browserAccess({ STORAGE_DRIVER: 's3', S3_BROWSER_ACCESS: 'proxy' })).toBe('proxy');
    expect(browserAccess({ STORAGE_DRIVER: 's3', S3_BROWSER_ACCESS: ' Direct ' })).toBe('direct');
  });

  it('hands out no presigned URL through the app, and one on the public endpoint when direct', async () => {
    const env = {
      STORAGE_DRIVER: 's3',
      S3_INTERNAL_ENDPOINT: 'http://minio:9000',
      S3_PUBLIC_ENDPOINT: 'https://files.example.test',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
    };
    const proxied = getStorage(env);
    expect(proxied.presignedUpload).toBe(false);
    expect(await proxied.presignPut('a/b.png', 'image/png', 60, 10)).toBeNull();
    expect(await proxied.presignGet('a/b.png', 'b.png', 60)).toBeNull();

    resetStorage();
    const direct = getStorage({ ...env, S3_BROWSER_ACCESS: 'direct' });
    expect(direct.presignedUpload).toBe(true);
    expect(await direct.presignPut('a/b.png', 'image/png', 60, 10)).toMatch(
      /^https:\/\/files\.example\.test\/influenceos\/a\/b\.png\?/,
    );
    expect(await direct.presignGet('a/b.png', 'b.png', 60)).toContain('X-Amz-Signature');
  });

  it('streams downloads over their own storage connections, closed when a viewer stops reading', async () => {
    type Handler = {
      configProvider: Promise<{ requestTimeout?: number; httpAgent: { maxSockets: number } }>;
    };
    type Clients = Record<'client' | 'readClient', { config: { requestHandler: Handler } }>;
    const driver = getStorage({
      STORAGE_DRIVER: 's3',
      S3_INTERNAL_ENDPOINT: 'http://minio:9000',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
    }) as unknown as Clients;
    const main = await driver.client.config.requestHandler.configProvider;
    const reads = await driver.readClient.config.requestHandler.configProvider;
    expect(reads.httpAgent).not.toBe(main.httpAgent);
    expect(reads.requestTimeout).toBe(60_000);
    expect(reads.httpAgent.maxSockets).toBe(100);
  });
});

describe('parseByteRange', () => {
  it('reads the ranges a video player sends', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('serves the whole file for no range or one it does not serve', () => {
    expect(parseByteRange(undefined, 1000)).toBeNull();
    expect(parseByteRange('bytes=0-1,5-6', 1000)).toBeNull();
    expect(parseByteRange('items=0-1', 1000)).toBeNull();
    expect(parseByteRange('bytes=-', 1000)).toBeNull();
    expect(parseByteRange('bytes=9-3', 1000)).toBeNull();
    expect(parseByteRange('bytes=0-9', 0)).toBeNull();
  });

  it('says when a range is past the end', () => {
    expect(parseByteRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', 1000)).toBe('unsatisfiable');
  });
});

describe('download links that stay the same for a while', () => {
  const prev = process.env.AUTH_SECRET;
  afterEach(() => {
    process.env.AUTH_SECRET = prev;
  });

  it('gives the same token within a window and a new one after it, each valid for at least a window', async () => {
    process.env.AUTH_SECRET = 'unit-test-secret-at-least-16';
    const hour = 3600;
    const start = Date.UTC(2026, 9, 12, 10, 0, 0);
    const a = await signDownloadTicket('att1', 600, { stable: hour, now: start + 5_000 });
    const b = await signDownloadTicket('att1', 600, { stable: hour, now: start + 3_500_000 });
    const c = await signDownloadTicket('att1', 600, { stable: hour, now: start + hour * 1000 + 1 });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    const payload = JSON.parse(Buffer.from(a.split('.')[1]!, 'base64url').toString()) as {
      iat: number;
      exp: number;
    };
    expect(payload.iat).toBe(start / 1000);
    expect(payload.exp).toBe(start / 1000 + 2 * hour);
    // A token for the current window verifies.
    const now = await signDownloadTicket('att1', 600, { stable: hour });
    await expect(verifyDownloadTicket(now)).resolves.toMatchObject({ attachmentId: 'att1' });
  });
});
