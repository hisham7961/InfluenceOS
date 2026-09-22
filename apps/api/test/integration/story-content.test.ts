import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PublishedContentDTO, UploadTicketDTO } from '@influenceos/contracts';
import { resetStorage } from '@influenceos/domain';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Story content (Add Content flow, Task 259) — a screenshot/recording
 * captured because Stories expire and can't be linked to directly. This is
 * a two-phase flow: POST /content/story creates the PublishedContent row
 * (no URL, no embed, no dedup check), then the media is uploaded as a
 * regular Attachment targeting that row's id via the SAME two-phase signed
 * upload every other attachment uses (POST /files -> PUT bytes -> POST
 * /files/complete). mapRow() picks the attachment back up as `storyMedia`.
 */
describe('Story content — create + attach media through the real API', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;
  const tag = `STORY-${Date.now()}`;

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    resetStorage();
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.publishedContent
      .deleteMany({ where: { OR: [{ caption: { contains: tag } }, { originalUrl: { contains: tag } }] } })
      .catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('creates a Story row with no URL/embed, then accepts an uploaded image as its media', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/content/story',
      headers: auth,
      payload: { platform: 'INSTAGRAM', caption: `${tag} screenshot` },
    });
    expect(created.statusCode).toBe(201);
    const dto = created.json() as PublishedContentDTO;
    expect(dto.isStory).toBe(true);
    expect(dto.storyMedia).toBeNull();
    expect(dto.embed).toBeNull();
    expect(dto.embeddable).toBe(false);
    // Synthetic, non-fetchable placeholder — never a real post URL.
    expect(dto.originalUrl.startsWith('story://')).toBe(true);

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const initiate = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: auth,
      payload: {
        fileName: 'story.png',
        mimeType: 'image/png',
        sizeBytes: bytes.length,
        target: { publishedContentId: dto.id },
      },
    });
    expect(initiate.statusCode).toBe(201);
    const ticket = initiate.json() as UploadTicketDTO;
    await app.inject({
      method: 'PUT',
      url: ticket.uploadUrl,
      headers: { ...auth, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    const completed = await app.inject({ method: 'POST', url: '/api/v1/files/complete', headers: auth, payload: { uploadToken: ticket.uploadToken } });
    expect(completed.statusCode).toBe(201);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/content/${dto.id}`, headers: auth });
    expect(detail.statusCode).toBe(200);
    const withMedia = detail.json() as PublishedContentDTO;
    expect(withMedia.isStory).toBe(true);
    expect(withMedia.storyMedia?.kind).toBe('image');
    expect(withMedia.storyMedia?.mimeType).toBe('image/png');
    expect(typeof withMedia.storyMedia?.url).toBe('string');
    expect(withMedia.storyMedia?.url.length).toBeGreaterThan(0);
  });

  it('a regular (link) content item is never marked as a Story and never carries storyMedia', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: auth,
      payload: { url: `https://www.youtube.com/watch?v=${tag}` },
    });
    expect(res.statusCode).toBe(201);
    const dto = res.json() as PublishedContentDTO;
    expect(dto.isStory).toBe(false);
    expect(dto.storyMedia).toBeNull();
  });

  it('requires CONTENT_MANAGE — a read-only VIEWER cannot create a Story', async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const { hash } = await import('@node-rs/argon2');
    const prisma = new PrismaClient();
    const email = `story_viewer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const viewerUser = await prisma.user.create({ data: { email, name: 'Story Viewer', role: 'VIEWER', passwordHash: await hash(password) } });
    await prisma.$disconnect();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const viewerAuth = { authorization: `Bearer ${token}` };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/content/story',
      headers: viewerAuth,
      payload: { platform: 'TIKTOK', caption: `${tag} forbidden` },
    });
    expect(res.statusCode).toBe(403);
    await deleteUser(viewerUser.id);
  });
});
