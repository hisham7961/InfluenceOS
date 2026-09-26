import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from '@influenceos/api-client';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P3.2 — AI assistance: off until an admin turns it on with a key and a
 * model; the key is sealed and never returned; reading an insights
 * screenshot returns suggestions only (nothing saved), keeps to scope, is
 * logged and counted against the monthly limit. Claude itself is replaced by
 * a fake client — no request leaves the machine.
 */
describe('P3.2 — AI screenshot reading', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let admin: Awaited<ReturnType<typeof clientFor>>;
  let staff: Awaited<ReturnType<typeof clientFor>>;
  let outsider: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const tag = `P32AI${Date.now()}`;
  const KEY = `sk-ant-test-${tag}-wxyz`;
  const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const keys: string[] = [];
  let brandId: string;
  let otherBrandId: string;
  let influencerId: string;
  let contentId: string;
  let otherContentId: string;
  let shotId: string;
  let textId: string;
  let otherShotId: string;
  let hadSettings: Awaited<ReturnType<typeof prisma.aiSettings.findUnique>>;
  const savedEnv = { key: process.env.ANTHROPIC_API_KEY, model: process.env.AI_MODEL };

  type Reply = {
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
    parsed_output: unknown;
  };
  const calls: { apiKey: string; req: Record<string, unknown> }[] = [];
  let next: () => Reply | Promise<Reply>;

  async function status(p: Promise<unknown>) {
    try {
      await p;
      return 200;
    } catch (e) {
      return (e as ApiError).status;
    }
  }

  async function message(p: Promise<unknown>) {
    try {
      await p;
      return null;
    } catch (e) {
      return (e as ApiError).message;
    }
  }

  async function userClient(label: string, opts: { role?: 'STAFF' | 'ADMIN'; brandId?: string }) {
    const { hash } = await import('@node-rs/argon2');
    const email = `${tag.toLowerCase()}_${label}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: {
        email,
        name: `${tag} ${label}`,
        role: opts.role ?? 'STAFF',
        roleProfile: 'GENERAL_MANAGER',
        passwordHash: await hash(password),
      },
    });
    users.push(user.id);
    if (opts.brandId)
      await prisma.userBrandAccess.create({ data: { userId: user.id, brandId: opts.brandId } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const { accessToken } = (res.json() as { tokens: { accessToken: string } }).tokens;
    return clientFor(app, { authorization: `Bearer ${accessToken}` });
  }

  async function attach(publishedContentId: string, mimeType: string, body: Buffer) {
    const { getStorage } = await import('@influenceos/domain');
    const key = `attachments/${tag}/${keys.length}-${mimeType.replace('/', '.')}`;
    await getStorage().save(key, body, mimeType);
    keys.push(key);
    const row = await prisma.attachment.create({
      data: {
        fileName: 'insights.png',
        mimeType,
        sizeBytes: body.length,
        storageKey: key,
        publishedContentId,
      },
    });
    return row.id;
  }

  const reading = (over: Record<string, unknown> = {}) => ({
    stop_reason: 'end_turn',
    usage: { input_tokens: 1500, output_tokens: 90 },
    parsed_output: {
      looksLikeInsights: true,
      views: 12_300,
      likes: 800,
      comments: -5,
      shares: null,
      saves: 40,
      capturedOn: '2026-09-20',
      note: 'Saves are partly cut off.',
      ...over,
    },
  });

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_MODEL;
    app = await makeApp();
    const a = await loginFresh(app);
    users.push(a.userId);
    admin = await clientFor(app, a.auth);
    const { PrismaClient } = await import('@influenceos/database');
    prisma = new PrismaClient();
    hadSettings = await prisma.aiSettings.findUnique({ where: { id: 'singleton' } });
    await prisma.aiSettings.deleteMany({});

    const { setAiClientFactory } = await import('@influenceos/domain');
    setAiClientFactory(
      (apiKey) =>
        ({
          messages: {
            parse: async (req: Record<string, unknown>) => {
              calls.push({ apiKey, req });
              return next();
            },
          },
        }) as never,
    );

    brandId = (
      await prisma.brand.create({ data: { name: `${tag} Brand`, slug: `${tag.toLowerCase()}-b` } })
    ).id;
    otherBrandId = (
      await prisma.brand.create({ data: { name: `${tag} Other`, slug: `${tag.toLowerCase()}-o` } })
    ).id;
    influencerId = (
      await prisma.influencer.create({ data: { displayName: `${tag} Creator`, countryCode: 'KW' } })
    ).id;
    contentId = (
      await prisma.publishedContent.create({
        data: {
          platform: 'SNAPCHAT',
          originalUrl: `https://snapchat.com/${tag}/1`,
          brandId,
          influencerId,
        },
      })
    ).id;
    otherContentId = (
      await prisma.publishedContent.create({
        data: {
          platform: 'TIKTOK',
          originalUrl: `https://tiktok.com/${tag}/2`,
          brandId: otherBrandId,
          influencerId,
        },
      })
    ).id;
    shotId = await attach(contentId, 'image/png', PNG);
    textId = await attach(contentId, 'text/plain', Buffer.from('not an image'));
    otherShotId = await attach(otherContentId, 'image/png', PNG);

    staff = await userClient('staff', { brandId });
    outsider = await userClient('outsider', { brandId: otherBrandId });
  });

  beforeEach(() => {
    calls.length = 0;
    next = () => reading();
  });

  afterAll(async () => {
    const { getStorage, resetAiClientFactory } = await import('@influenceos/domain');
    resetAiClientFactory();
    for (const key of keys)
      await getStorage()
        .remove(key)
        .catch(() => undefined);
    await prisma.aiRequest.deleteMany({
      where: { publishedContentId: { in: [contentId, otherContentId] } },
    });
    await prisma.publishedContent.deleteMany({
      where: { id: { in: [contentId, otherContentId] } },
    });
    await prisma.influencer.deleteMany({ where: { id: influencerId } });
    await prisma.brand.deleteMany({ where: { id: { in: [brandId, otherBrandId] } } });
    await prisma.aiSettings.deleteMany({});
    if (hadSettings) await prisma.aiSettings.create({ data: hadSettings });
    if (savedEnv.key !== undefined) process.env.ANTHROPIC_API_KEY = savedEnv.key;
    if (savedEnv.model !== undefined) process.env.AI_MODEL = savedEnv.model;
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  const read = (client = staff, attachmentId = shotId, id = contentId) =>
    client.content.readMetricsScreenshot(id, { attachmentId, locale: 'en' });

  it('is off until an admin turns it on, and only admins see or change the settings', async () => {
    expect(await staff.ai.status()).toEqual({
      available: false,
      readScreenshots: false,
      writingHelp: false,
      remaining: null,
    });
    expect(await message(read())).toBe(
      'AI assistance is turned off. An admin can turn it on in Settings → AI.',
    );
    expect(calls).toHaveLength(0);

    expect(await status(staff.ai.settings())).toBe(403);
    expect(await status(staff.ai.updateSettings({ enabled: true }))).toBe(403);

    // Can't switch on without a key and a model.
    expect(await status(admin.ai.updateSettings({ enabled: true }))).toBe(422);
    expect((await admin.ai.settings()).enabled).toBe(false);
  });

  it('keeps the key sealed and never returns it', async () => {
    const s = await admin.ai.updateSettings({
      enabled: true,
      apiKey: KEY,
      model: 'test-model',
      monthlyLimit: 2,
    });
    expect(s).toMatchObject({
      enabled: true,
      model: 'test-model',
      modelSource: 'SETTINGS',
      apiKey: { source: 'SETTINGS', last4: 'wxyz' },
      monthlyLimit: 2,
      available: true,
      usage: { used: 0, failed: 0, byFeature: [] },
    });
    expect(JSON.stringify(s)).not.toContain(KEY);
    const row = await prisma.aiSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
    expect(row.sealedApiKey).toBeTruthy();
    expect(row.sealedApiKey).not.toContain(KEY);
    const log = await prisma.activityLog.findFirst({
      where: { actorId: users[0] },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.message).toBe('Test Admin changed the AI settings.');
    expect(JSON.stringify(log?.meta)).not.toContain(KEY);

    expect(await staff.ai.status()).toEqual({
      available: true,
      readScreenshots: true,
      writingHelp: true,
      remaining: 2,
    });
  });

  it('reads the numbers as suggestions, logs the call and saves nothing', async () => {
    const res = await read();
    expect(res).toEqual({
      values: { views: 12_300, likes: 800, comments: null, shares: null, saves: 40 },
      capturedOn: '2026-09-20',
      looksLikeInsights: true,
      note: 'Saves are partly cut off.',
      remaining: 1,
    });

    // One call, with the stored key and model and the screenshot's own bytes.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.apiKey).toBe(KEY);
    const req = calls[0]!.req as {
      model: string;
      messages: { content: { type: string; source?: { media_type: string; data: string } }[] }[];
    };
    expect(req.model).toBe('test-model');
    const image = req.messages[0]!.content.find((c) => c.type === 'image')!;
    expect(image.source).toMatchObject({ media_type: 'image/png', data: PNG.toString('base64') });

    const logged = await prisma.aiRequest.findMany({ where: { publishedContentId: contentId } });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      feature: 'READ_SCREENSHOT',
      status: 'OK',
      inputTokens: 1500,
      outputTokens: 90,
    });
    expect(
      await prisma.contentMetricSnapshot.count({ where: { publishedContentId: contentId } }),
    ).toBe(0);
  });

  it('says so when the image is not an insights screen, and drops a future date', async () => {
    await admin.ai.updateSettings({ monthlyLimit: 50 });
    next = () => reading({ looksLikeInsights: false, views: 99, capturedOn: '2026-09-20' });
    const res = await read();
    expect(res.looksLikeInsights).toBe(false);
    expect(Object.values(res.values).every((v) => v === null)).toBe(true);
    expect(res.capturedOn).toBeNull();

    next = () => reading({ capturedOn: '2099-01-01' });
    expect((await read()).capturedOn).toBeNull();
  });

  it('logs a declined request, and counts it against the limit', async () => {
    const used = (await admin.ai.settings()).usage.used;
    await admin.ai.updateSettings({ monthlyLimit: used + 1 });
    next = () => ({
      stop_reason: 'refusal',
      usage: { input_tokens: 10, output_tokens: 0 },
      parsed_output: null,
    });
    expect(await message(read())).toBe('The AI declined this request.');
    expect(
      await prisma.aiRequest.count({ where: { publishedContentId: contentId, status: 'REFUSED' } }),
    ).toBe(1);

    // The month's requests are now used up.
    expect(await message(read())).toBe(
      "This month's AI requests are used up. An admin can raise the limit in Settings → AI.",
    );
    expect(calls).toHaveLength(1);
    expect((await staff.ai.status()).remaining).toBe(0);
  });

  it('turns API failures into clear errors, logged but not counted', async () => {
    await admin.ai.updateSettings({ monthlyLimit: 50 });
    const before = (await admin.ai.settings()).usage;
    next = () => {
      throw Anthropic.APIError.generate(
        401,
        { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
        'invalid x-api-key',
        new Headers(),
      );
    };
    expect(await message(read())).toBe(
      'The Claude API key was refused. An admin can check it in Settings → AI.',
    );
    next = () => {
      throw new Error('socket hang up');
    };
    expect(await message(read())).toBe("The AI service didn't answer. Try again.");
    next = () => ({
      stop_reason: 'max_tokens',
      usage: { input_tokens: 10, output_tokens: 4096 },
      parsed_output: null,
    });
    expect(await message(read())).toBe("The AI answer couldn't be used. Try again.");

    const after = (await admin.ai.settings()).usage;
    expect(after.used).toBe(before.used);
    expect(after.failed).toBe(before.failed + 3);
  });

  it('only reads an image attached to this post, within scope', async () => {
    expect(await status(read(staff, textId))).toBe(400);
    expect(await status(read(staff, otherShotId))).toBe(404);
    // Another brand's post, and this brand's post for another brand's user.
    expect(await status(read(staff, otherShotId, otherContentId))).toBe(404);
    expect(await status(read(outsider))).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('respects the feature switch, and falls back to the environment key', async () => {
    await admin.ai.updateSettings({ readScreenshots: false });
    expect(await message(read())).toBe('This AI feature is turned off in Settings → AI.');
    expect((await staff.ai.status()).readScreenshots).toBe(false);
    await admin.ai.updateSettings({ readScreenshots: true });

    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-key-for-tests-9876';
    try {
      const s = await admin.ai.updateSettings({ apiKey: null });
      expect(s.apiKey).toEqual({ source: 'ENV', last4: '9876' });
      await read();
      expect(calls.at(-1)!.apiKey).toBe('sk-ant-env-key-for-tests-9876');
      // With neither, AI can't stay on.
      delete process.env.ANTHROPIC_API_KEY;
      expect((await staff.ai.status()).available).toBe(false);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("reads a creator's audience screenshot as suggestions, within scope", async () => {
    await admin.ai.updateSettings({
      enabled: true,
      apiKey: KEY,
      model: 'test-model',
      readScreenshots: true,
      monthlyLimit: 500,
    });
    await prisma.brandInfluencer.create({ data: { brandId, influencerId } });
    const other = await prisma.influencer.create({
      data: { displayName: `${tag} Other creator`, countryCode: 'KW' },
    });
    const own = async (id: string, mimeType: string, body: Buffer) => {
      const { getStorage } = await import('@influenceos/domain');
      const key = `attachments/${tag}/aud-${keys.length}-${mimeType.replace('/', '.')}`;
      await getStorage().save(key, body, mimeType);
      keys.push(key);
      return (
        await prisma.attachment.create({
          data: {
            fileName: 'audience.png',
            mimeType,
            sizeBytes: body.length,
            storageKey: key,
            influencerId: id,
          },
        })
      ).id;
    };
    const shot = await own(influencerId, 'image/png', PNG);
    const text = await own(influencerId, 'text/plain', Buffer.from('not an image'));
    const othersShot = await own(other.id, 'image/png', PNG);
    try {
      next = () => ({
        stop_reason: 'end_turn',
        usage: { input_tokens: 1400, output_tokens: 120 },
        parsed_output: {
          looksLikeAudience: true,
          countries: [
            { countryCode: 'kw', pct: 41.26 },
            { countryCode: 'SA', pct: 20 },
            { countryCode: 'XX', pct: 5 },
            { countryCode: 'KW', pct: 3 },
            { countryCode: 'AE', pct: 140 },
          ],
          femalePct: 62,
          malePct: 38,
          age13to17: null,
          age18to24: 30,
          age25to34: 40,
          age35to44: 15,
          age45to54: 8,
          age55to64: 4,
          age55plus: null,
          age65plus: 1,
          engagementRate: 3.4,
          capturedOn: '2026-09-01',
          note: 'Only the top five countries are shown.',
        },
      });
      const readAudience = (client = staff, attachmentId = shot, id = influencerId) =>
        client.audience.readScreenshot(id, { attachmentId, locale: 'en' });
      const res = await readAudience();
      expect(res).toMatchObject({
        values: {
          // Unknown and repeated countries and impossible shares are dropped.
          countries: [
            { countryCode: 'KW', pct: 41.3 },
            { countryCode: 'SA', pct: 20 },
          ],
          femalePct: 62,
          malePct: 38,
          // 45+ is the screen's older groups added up.
          ages: {
            age13to17Pct: null,
            age18to24Pct: 30,
            age25to34Pct: 40,
            age35to44Pct: 15,
            age45PlusPct: 13,
          },
          engagementRate: 3.4,
        },
        capturedOn: '2026-09-01',
        looksLikeAudience: true,
        note: 'Only the top five countries are shown.',
      });
      const req = calls.at(-1)!.req as { messages: { content: { type: string }[] }[] };
      expect(req.messages[0]!.content.some((c) => c.type === 'image')).toBe(true);
      // Nothing saved.
      expect(
        await prisma.audienceInsight.count({ where: { socialAccount: { influencerId } } }),
      ).toBe(0);

      const before = calls.length;
      expect(await status(readAudience(staff, text))).toBe(400);
      expect(await status(readAudience(staff, othersShot))).toBe(404);
      expect(await status(readAudience(outsider))).toBe(404);
      expect(calls.length).toBe(before);
    } finally {
      await prisma.aiRequest.deleteMany({
        where: { feature: 'READ_SCREENSHOT', publishedContentId: null, userId: { in: users } },
      });
      await prisma.brandInfluencer.deleteMany({ where: { influencerId } });
      await prisma.influencer.deleteMany({ where: { id: other.id } });
    }
  });
});
