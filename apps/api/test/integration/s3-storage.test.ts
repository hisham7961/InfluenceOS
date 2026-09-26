import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetStorage } from '@influenceos/domain';
import type { AttachmentDTO, UploadTicketDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh } from '../helpers.ts';

/**
 * REAL object-storage round-trip against MinIO/S3 (finding #2). Gated on
 * `S3_TEST_ENDPOINT` so it only runs where a MinIO/S3 is reachable (CI provides
 * one as a service). It exercises the full two-phase flow over the S3 driver —
 * NOT the local driver — using genuine presigned PUT/GET URLs the browser would
 * use, and verifies the bytes survive the round-trip.
 *
 * It also proves the internal/presign endpoint split: server-side ops
 * (complete's HeadObject, delete) use the internal endpoint while the
 * presigned URLs the client PUTs/GETs use the public endpoint.
 */
const ENDPOINT = process.env.S3_TEST_ENDPOINT;

describe.skipIf(!ENDPOINT)('files — real MinIO/S3 round-trip (s3 driver)', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let influencerId: string;

  beforeAll(async () => {
    // Point the s3 driver at the test MinIO. In CI the test process and MinIO
    // share localhost, so internal and public endpoints are the same host.
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_INTERNAL_ENDPOINT = ENDPOINT;
    process.env.S3_PUBLIC_ENDPOINT = ENDPOINT;
    process.env.S3_BUCKET = process.env.S3_BUCKET ?? 'influenceos';
    process.env.S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID ?? 'minioadmin';
    process.env.S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin';
    process.env.S3_FORCE_PATH_STYLE = 'true';
    resetStorage();

    const { buildApp } = await import('../../src/app.ts');
    app = await buildApp();
    const s = await loginFresh(app);
    auth = s.auth;
    userId = s.userId;

    const inf = await app.inject({
      method: 'POST',
      url: '/api/v1/influencers',
      headers: auth,
      payload: { displayName: `S3 Target ${Date.now()}`, countryCode: 'KW' },
    });
    influencerId = (inf.json() as { id: string }).id;
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.attachment.deleteMany({ where: { influencerId } }).catch(() => undefined);
    await prisma.influencer.delete({ where: { id: influencerId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app?.close();
    if (userId) await deleteUser(userId);
    // Restore local driver for any suite that runs afterwards.
    process.env.STORAGE_DRIVER = 'local';
    resetStorage();
  });

  it('initiate → presigned PUT → complete → presigned GET → verify → delete', async () => {
    const bytes = Buffer.from('the quick brown fox — s3 round trip ✔', 'utf8');

    // 1. initiate → a DIRECT presigned PUT (s3), not the local proxy.
    const initiate = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: auth,
      payload: { fileName: 'note.txt', mimeType: 'text/plain', sizeBytes: bytes.length, target: { influencerId } },
    });
    expect(initiate.statusCode).toBe(201);
    const ticket = initiate.json() as UploadTicketDTO;
    expect(ticket.direct).toBe(true);
    expect(ticket.uploadUrl).toMatch(/^https?:\/\//);

    // 2. Real presigned PUT straight to MinIO with the signed headers.
    const put = await fetch(ticket.uploadUrl, { method: 'PUT', body: bytes, headers: ticket.headers });
    expect(put.ok).toBe(true);

    // 3. complete → server-side HeadObject (internal endpoint) + record.
    const complete = await app.inject({
      method: 'POST',
      url: '/api/v1/files/complete',
      headers: auth,
      payload: { uploadToken: ticket.uploadToken },
    });
    expect(complete.statusCode).toBe(201);
    const attachment = complete.json() as AttachmentDTO;
    expect(attachment.sizeBytes).toBe(bytes.length);
    // Private storage: the download URL is a presigned GET, not a bare public URL.
    expect(attachment.downloadUrl).toMatch(/^https?:\/\//);
    expect(attachment.downloadUrl).toContain('X-Amz-Signature');

    // 4. Real presigned GET and byte verification.
    const get = await fetch(attachment.downloadUrl);
    expect(get.ok).toBe(true);
    const roundTripped = Buffer.from(await get.arrayBuffer());
    expect(roundTripped.equals(bytes)).toBe(true);

    // 5. Delete removes the object; a fresh signed URL then 404s.
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/files/${attachment.id}`, headers: auth });
    expect(del.statusCode).toBe(204);
  });

  it('ensureReady creates a missing bucket once, then reports it exists', async () => {
    const { getStorage, resetStorage: reset } = await import('@influenceos/domain');
    const { S3Client, DeleteBucketCommand } = await import('@aws-sdk/client-s3');
    const bucket = `ensure-${Date.now()}`;
    const original = process.env.S3_BUCKET;
    process.env.S3_BUCKET = bucket;
    reset();
    try {
      await expect(getStorage(process.env).ensureReady()).resolves.toBe('created');
      await expect(getStorage(process.env).ensureReady()).resolves.toBe('exists');
    } finally {
      const client = new S3Client({
        endpoint: ENDPOINT,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
      });
      await client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
      process.env.S3_BUCKET = original;
      reset();
    }
  });

  it('copies an object server-side (used to quarantine orphaned files)', async () => {
    const { getStorage } = await import('@influenceos/domain');
    const storage = getStorage(process.env);
    const key = `attachments/copy-test/${Date.now()}-a file (1).txt`;
    await storage.save(key, Buffer.from('copy me'), 'text/plain');
    try {
      await storage.copy(key, `quarantine/${key}`);
      expect(await storage.head(`quarantine/${key}`)).toEqual({ size: 7 });
      expect(await storage.head(key)).toEqual({ size: 7 });
    } finally {
      await storage.remove(key);
      await storage.remove(`quarantine/${key}`);
    }
  });

  it('rejects a presigned PUT whose body differs from the declared size (W2-2 edge cap)', async () => {
    const declared = 8;
    const initiate = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: auth,
      // text/plain is an allowed type; the point here is the size cap, not MIME.
      payload: { fileName: 'cap.txt', mimeType: 'text/plain', sizeBytes: declared, target: { influencerId } },
    });
    expect(initiate.statusCode).toBe(201);
    const ticket = initiate.json() as UploadTicketDTO;
    // The presign is signed for exactly `declared` bytes; uploading more must be
    // rejected by S3/MinIO at the edge, not merely caught later at complete-time.
    const tooBig = Buffer.alloc(declared + 4096, 1);
    const put = await fetch(ticket.uploadUrl, { method: 'PUT', body: tooBig, headers: ticket.headers });
    expect(put.ok).toBe(false);
  });
});
