import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InspirationItemDTO } from '@influenceos/contracts';
import { deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * A saved trend link used to always render as a plain "Open Original" link,
 * even when it pointed at a video-hosting platform (user report: "بدي اياه
 * يظهر ك فيديو يعرض المحتوى مثل فيديوهات الانفلونسر" — show it as a video,
 * the same way influencer content plays). inspiration.service.ts now derives
 * `embed`/`embeddable`/`thumbnailUrl` the same way content.service.ts does
 * for PublishedContent, reusing buildEmbed/detectPlatform/resolveContentThumbnail
 * rather than a parallel mechanism. Proves both branches end to end: a known
 * video platform URL gets a real embed, and a plain reference link (a blog
 * post, an article — not required to be a social platform) degrades to the
 * existing plain-link behavior instead of erroring.
 */
describe('Trends & Inspiration — video embed derivation', () => {
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  const createdIds: string[] = [];

  const idOf = (r: { json: () => unknown }) => (r.json() as { id: string }).id;

  beforeAll(async () => {
    app = await makeApp();
    const a = await loginFresh(app);
    auth = a.auth;
    userId = a.userId;
  });

  afterAll(async () => {
    const { PrismaClient } = await import('@influenceos/database');
    const prisma = new PrismaClient();
    await prisma.inspirationItem.deleteMany({ where: { id: { in: createdIds } } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
    await deleteUser(userId);
  });

  it('a YouTube link gets a real iframe embed, a derived thumbnail, and an auto-detected platform (no platform field sent)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inspiration',
      headers: auth,
      payload: { url: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`, category: 'TREND' },
    });
    expect(res.statusCode).toBe(201);
    const item = res.json() as InspirationItemDTO;
    createdIds.push(item.id);

    expect(item.platform).toBe('YOUTUBE');
    expect(item.embeddable).toBe(true);
    expect(item.embed?.kind).toBe('iframe');
    expect(item.embed?.iframeSrc).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    // Derived instantly from the video id, no network call needed.
    expect(item.thumbnailUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');

    // Confirmed persisted/re-derived on a fresh read, not just echoed on create.
    const refetched = (await app.inject({ method: 'GET', url: `/api/v1/inspiration/${item.id}`, headers: auth })).json() as InspirationItemDTO;
    expect(refetched.embeddable).toBe(true);
    expect(refetched.thumbnailUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });

  it('a non-platform reference link (an article, not a required social post) stays a plain link — no error, no embed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inspiration',
      headers: auth,
      payload: { url: `https://example.com/marketing-article-${Date.now()}`, category: 'OTHER' },
    });
    expect(res.statusCode).toBe(201);
    const item = res.json() as InspirationItemDTO;
    createdIds.push(item.id);

    expect(item.platform).toBeNull();
    expect(item.embeddable).toBe(false);
    expect(item.embed).toBeNull();
    expect(item.thumbnailUrl).toBeNull();
  });
});
