import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetStorage } from '@influenceos/domain';
import type { AttachmentDTO, PublishedContentDTO, UploadTicketDTO } from '@influenceos/contracts';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';
import { startFakeS3, type FakeS3 } from '../fake-s3.ts';

/**
 * Files go through the app (S3_BROWSER_ACCESS=proxy, the default) with the
 * s3 driver — the production setup, where MinIO is private and browsers can't
 * reach it. The public endpoint here is deliberately unreachable: if anything
 * handed the browser a presigned URL again, these tests would fail, exactly
 * as every upload failed in production ("Upload failed — network error.").
 *
 * Runs against a real MinIO when S3_TEST_ENDPOINT is set (CI), otherwise
 * against an in-process stand-in.
 */
const S3_KEYS = [
  'STORAGE_DRIVER',
  'S3_INTERNAL_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
  'S3_BROWSER_ACCESS',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE',
] as const;
const UNREACHABLE = 'http://storage.invalid:9';

describe('files through the app (s3 driver, private store)', () => {
  const saved: Partial<Record<(typeof S3_KEYS)[number], string | undefined>> = {};
  let fake: FakeS3 | null = null;
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let otherAuth: Record<string, string>;
  const users: string[] = [];
  let influencerId: string;
  const tag = `FTA${Date.now()}`;
  let prisma: import('@influenceos/database').PrismaClient;
  let brandId: string;
  let campaignId: string;
  let taskId: string;
  let linkToken: string;

  // 300 bytes with a recognisable pattern, so byte ranges can be checked.
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(Array.from({ length: 292 }, (_, i) => i % 251)),
  ]);

  async function initiate(
    headers: Record<string, string>,
    body: Buffer,
    target: Record<string, string>,
  ) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers,
      payload: { fileName: 'story.png', mimeType: 'image/png', sizeBytes: body.length, target },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as UploadTicketDTO;
  }

  const putBlob = (url: string, headers: Record<string, string>, body: Buffer) =>
    app.inject({
      method: 'PUT',
      url,
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      payload: body,
    });

  async function upload(target: Record<string, string>): Promise<AttachmentDTO> {
    const ticket = await initiate(auth, PNG, target);
    expect((await putBlob(ticket.uploadUrl, auth, PNG)).statusCode).toBe(204);
    const done = await app.inject({
      method: 'POST',
      url: '/api/v1/files/complete',
      headers: auth,
      payload: { uploadToken: ticket.uploadToken },
    });
    expect(done.statusCode).toBe(201);
    return done.json() as AttachmentDTO;
  }

  beforeAll(async () => {
    for (const k of S3_KEYS) saved[k] = process.env[k];
    let endpoint = process.env.S3_TEST_ENDPOINT;
    if (!endpoint) {
      fake = await startFakeS3();
      endpoint = fake.endpoint;
    }
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_INTERNAL_ENDPOINT = endpoint;
    process.env.S3_PUBLIC_ENDPOINT = UNREACHABLE;
    delete process.env.S3_BROWSER_ACCESS; // the default
    process.env.S3_BUCKET = `fta-${Date.now()}`;
    process.env.S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID ?? 'minioadmin';
    process.env.S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin';
    process.env.S3_FORCE_PATH_STYLE = 'true';
    resetStorage();
    const { getStorage } = await import('@influenceos/domain');
    await getStorage(process.env).ensureReady();

    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    users.push(a.userId);
    const b = await loginFresh(app);
    otherAuth = b.auth;
    users.push(b.userId);

    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    influencerId = (
      await prisma.influencer.create({ data: { displayName: `${tag} Sara`, countryCode: 'KW' } })
    ).id;
    brandId = (
      await prisma.brand.create({ data: { name: `${tag} Brand`, slug: tag.toLowerCase() } })
    ).id;
    campaignId = (
      await prisma.campaign.create({
        data: {
          brandId,
          name: `${tag} Launch`,
          slug: `${tag.toLowerCase()}-l`,
          status: 'ACTIVE',
          draftReview: true,
        },
      })
    ).id;
    const row = await prisma.campaignInfluencer.create({
      data: { campaignId, influencerId, participationStatus: 'CONFIRMED' },
    });
    taskId = (
      await prisma.deliverable.create({
        data: { campaignInfluencerId: row.id, platform: 'INSTAGRAM', type: 'REEL' },
      })
    ).id;
    const api = await clientFor(app, auth);
    linkToken = (await api.creatorLinks.create(row.id, {})).path.replace('/share/c/', '');
  });

  afterAll(async () => {
    await prisma?.attachment
      .deleteMany({ where: { OR: [{ influencerId }, { deliverableId: taskId }] } })
      .catch(() => undefined);
    await prisma?.publishedContent.deleteMany({ where: { influencerId } }).catch(() => undefined);
    await prisma?.activityLog.deleteMany({ where: { campaignId } }).catch(() => undefined);
    await prisma?.brand.deleteMany({ where: { id: brandId } }).catch(() => undefined);
    await prisma?.influencer.deleteMany({ where: { id: influencerId } }).catch(() => undefined);
    await prisma?.$disconnect();
    await app?.close();
    for (const u of users) await deleteUser(u);
    await fake?.close();
    for (const k of S3_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetStorage();
  });

  it('hands the browser the app’s own upload address, never the store', async () => {
    const ticket = await initiate(auth, PNG, { influencerId });
    expect(ticket.direct).toBe(false);
    expect(ticket.uploadUrl).toMatch(/^\/api\/v1\/files\/blob\?token=/);
    expect(ticket.headers).toEqual({});
    expect(JSON.stringify(ticket)).not.toContain('storage.invalid');
  });

  it('uploads through the app and downloads through a signed link — whole or by byte range', async () => {
    const file = await upload({ influencerId });
    expect(file.sizeBytes).toBe(PNG.length);
    expect(file.downloadUrl).toMatch(/^\/api\/v1\/files\/[^/]+\/blob\?token=/);
    expect(file.downloadUrl).not.toContain('X-Amz');

    const whole = await app.inject({ method: 'GET', url: file.downloadUrl });
    expect(whole.statusCode).toBe(200);
    expect(whole.rawPayload.equals(PNG)).toBe(true);
    expect(whole.headers['content-type']).toBe('image/png');
    expect(whole.headers['content-length']).toBe(String(PNG.length));
    expect(whole.headers['accept-ranges']).toBe('bytes');
    expect(whole.headers['content-disposition']).toMatch(/^inline;/);
    expect(whole.headers['cache-control']).toContain('no-transform');
    expect(whole.headers['x-content-type-options']).toBe('nosniff');

    const part = await app.inject({
      method: 'GET',
      url: file.downloadUrl,
      headers: { range: 'bytes=8-17' },
    });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 8-17/${PNG.length}`);
    expect(part.rawPayload.equals(PNG.subarray(8, 18))).toBe(true);

    const tail = await app.inject({
      method: 'GET',
      url: file.downloadUrl,
      headers: { range: 'bytes=-5' },
    });
    expect(tail.statusCode).toBe(206);
    expect(tail.rawPayload.equals(PNG.subarray(PNG.length - 5))).toBe(true);

    const open = await app.inject({
      method: 'GET',
      url: file.downloadUrl,
      headers: { range: 'bytes=290-' },
    });
    expect(open.statusCode).toBe(206);
    expect(open.headers['content-range']).toBe(`bytes 290-${PNG.length - 1}/${PNG.length}`);

    const past = await app.inject({
      method: 'GET',
      url: file.downloadUrl,
      headers: { range: `bytes=${PNG.length}-` },
    });
    expect(past.statusCode).toBe(416);
    expect(past.headers['content-range']).toBe(`bytes */${PNG.length}`);

    // The link is the permission: a token for another file doesn't open this one.
    const other = await upload({ influencerId });
    const swapped = file.downloadUrl.replace(file.id, other.id);
    expect((await app.inject({ method: 'GET', url: swapped })).statusCode).toBe(400);
  });

  it('a Story’s image is uploaded and shown through the app', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/content/story',
      headers: auth,
      payload: { platform: 'INSTAGRAM', influencerId },
    });
    expect(created.statusCode).toBe(201);
    const storyId = (created.json() as PublishedContentDTO).id;
    await upload({ publishedContentId: storyId });

    const story = (
      await app.inject({ method: 'GET', url: `/api/v1/content/${storyId}`, headers: auth })
    ).json() as PublishedContentDTO;
    expect(story.storyMedia?.kind).toBe('image');
    expect(story.storyMedia?.url).toMatch(/^\/api\/v1\/files\/[^/]+\/blob\?token=/);
    const img = await app.inject({ method: 'GET', url: story.storyMedia!.url });
    expect(img.statusCode).toBe(200);
    expect(img.rawPayload.equals(PNG)).toBe(true);
  });

  it('takes bytes only from the person the ticket was made for, signed in, at exactly the declared size', async () => {
    const ticket = await initiate(auth, PNG, { influencerId });
    // Not signed in.
    expect((await putBlob(ticket.uploadUrl, {}, PNG)).statusCode).toBe(401);
    // Someone else's session.
    expect((await putBlob(ticket.uploadUrl, otherAuth, PNG)).statusCode).toBe(400);
    // A made-up ticket.
    expect((await putBlob('/api/v1/files/blob?token=forged', auth, PNG)).statusCode).toBe(400);
    // Fewer bytes than declared.
    expect((await putBlob(ticket.uploadUrl, auth, PNG.subarray(0, 100))).statusCode).toBe(400);
    // Nothing was stored by any of those.
    const notThere = await app.inject({
      method: 'POST',
      url: '/api/v1/files/complete',
      headers: auth,
      payload: { uploadToken: ticket.uploadToken },
    });
    expect(notThere.statusCode).toBe(400);
  });

  it('a creator’s draft file goes through their link’s own upload address', async () => {
    const creator = await clientFor(app, {});
    const ticket = await creator.creatorLinks.startUpload(linkToken, taskId, {
      fileName: 'draft.png',
      mimeType: 'image/png',
      sizeBytes: PNG.length,
    });
    expect(ticket.direct).toBe(false);
    expect(ticket.uploadUrl).toMatch(/^\/api\/v1\/public\/creator\/[^/]+\/uploads\?ticket=/);

    // A made-up ticket is refused before the bytes are read.
    const bad = await app.inject({
      method: 'PUT',
      url: `/api/v1/public/creator/${linkToken}/uploads?ticket=forged`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: PNG,
    });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(bad.statusCode).toBeLessThan(500);

    const put = await app.inject({
      method: 'PUT',
      url: ticket.uploadUrl,
      headers: { 'content-type': 'application/octet-stream' },
      payload: PNG,
    });
    expect(put.statusCode).toBe(204);
    const portal = await creator.creatorLinks.sendDraft(linkToken, taskId, {
      uploadToken: ticket.uploadToken,
    });
    expect(portal.tasks.find((t) => t.id === taskId)!.drafts[0]).toMatchObject({
      fileName: 'draft.png',
    });
  });

  it('with S3_BROWSER_ACCESS=direct, browsers get presigned URLs on the public endpoint instead', async () => {
    process.env.S3_BROWSER_ACCESS = 'direct';
    resetStorage();
    try {
      const ticket = await initiate(auth, PNG, { influencerId });
      expect(ticket.direct).toBe(true);
      expect(ticket.uploadUrl.startsWith(UNREACHABLE)).toBe(true);
      expect(ticket.uploadUrl).toContain('X-Amz-Signature');
    } finally {
      delete process.env.S3_BROWSER_ACCESS;
      resetStorage();
    }
  });
});
