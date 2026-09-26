import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * Post covers kept in our own storage: the worker's step saves a cover from
 * the platform's image host (never anywhere else), the post then shows our
 * signed link, the link serves the image without a login but refuses a
 * tampered or foreign one, an expired platform link is looked up again, and
 * deleting the post removes the saved file.
 */
describe('saved post covers', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let domain: typeof import('@influenceos/domain');
  let api: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const stamp = Date.now();
  const ids: Record<string, string> = {};
  const JPEG = Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    stamp % 256,
  ]);
  const fetched: string[] = [];

  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    fetched.push(url);
    if (url.includes('expired')) return new Response(null, { status: 403 });
    if (url.includes('page')) return new Response('<html>not an image</html>', { status: 200 });
    return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };

  async function post(name: string, thumbnailUrl: string) {
    ids[name] = (
      await prisma.publishedContent.create({
        data: {
          platform: 'INSTAGRAM',
          originalUrl: `https://www.instagram.com/p/cov${stamp}${name}/`,
          thumbnailUrl,
        },
      })
    ).id;
  }

  beforeAll(async () => {
    app = await makeApp();
    const admin = await loginFresh(app);
    users.push(admin.userId);
    api = await clientFor(app, admin.auth);
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    domain = await import('@influenceos/domain');
    await post('good', `https://scontent.cdninstagram.com/v/${stamp}/good.jpg`);
    await post('internal', `https://169.254.169.254/latest/${stamp}.jpg`);
    await post('page', `https://scontent.cdninstagram.com/v/${stamp}/page.jpg`);
    await post('expired', `https://scontent.cdninstagram.com/v/${stamp}/expired.jpg`);
  });

  afterAll(async () => {
    await prisma.publishedContent.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
    for (const u of users) await deleteUser(u);
    await app.close();
  });

  it('saves covers only from the platforms’ image hosts, and only images', async () => {
    const res = await domain.saveCovers(prisma, 10, {
      only: Object.values(ids),
      fetchImpl: fakeFetch,
      resolveThumbnail: async () => `https://scontent.cdninstagram.com/v/${stamp}/fresh.jpg`,
    });
    expect(res).toEqual({ saved: 2, failed: 2 });
    expect(fetched.some((u) => u.includes('169.254'))).toBe(false);

    const rows = await prisma.publishedContent.findMany({
      where: { id: { in: Object.values(ids) } },
      select: { id: true, coverKey: true, coverTries: true, thumbnailUrl: true },
    });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[ids.good!]!.coverKey).toBe(`covers/${ids.good}.jpg`);
    expect(by[ids.internal!]!).toMatchObject({ coverKey: null, coverTries: 1 });
    expect(by[ids.page!]!).toMatchObject({ coverKey: null, coverTries: 1 });
    // The expired link was looked up again and the fresh cover saved.
    expect(by[ids.expired!]!.coverKey).toBe(`covers/${ids.expired}.jpg`);
    expect(by[ids.expired!]!.thumbnailUrl).toContain('fresh.jpg');
  });

  it('shows the saved copy through a signed link that works without a login', async () => {
    const detail = await api.content.get(ids.good!);
    expect(detail.thumbnailUrl).toMatch(new RegExp(`^/api/v1/covers/${ids.good}\\?e=\\d+&s=`));

    const ok = await app.inject({ method: 'GET', url: detail.thumbnailUrl! });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.headers['cache-control']).toContain('max-age=86400');
    expect(Buffer.compare(ok.rawPayload, JPEG)).toBe(0);

    const tampered = detail.thumbnailUrl!.replace(/s=[^&]+/, 's=AAAA');
    expect((await app.inject({ method: 'GET', url: tampered })).statusCode).toBe(404);
    // A good signature for one post opens nothing else.
    const foreign = detail.thumbnailUrl!.replace(ids.good!, ids.expired!);
    expect((await app.inject({ method: 'GET', url: foreign })).statusCode).toBe(404);

    // A post without a saved copy keeps the platform's link.
    const page = await api.content.get(ids.page!);
    expect(page.thumbnailUrl).toContain('cdninstagram.com');
  });

  it('stops trying after a few failures', async () => {
    const only = {
      only: Object.values(ids),
      fetchImpl: fakeFetch,
      resolveThumbnail: async () => null,
    };
    for (let i = 0; i < 3; i += 1) {
      await domain.saveCovers(prisma, 50, only);
    }
    const row = await prisma.publishedContent.findUnique({ where: { id: ids.page! } });
    expect(row!.coverTries).toBe(domain.MAX_COVER_TRIES);
    const before = fetched.length;
    await domain.saveCovers(prisma, 50, only);
    expect(fetched.slice(before).some((u) => u.includes(`${stamp}/page`))).toBe(false);
  });

  it('removes the saved cover with the post', async () => {
    const storage = domain.getStorage();
    const key = `covers/${ids.good}.jpg`;
    expect(await storage.head(key)).not.toBeNull();
    await api.content.remove(ids.good!);
    expect(await storage.head(key)).toBeNull();
    delete ids.good;
  });
});
