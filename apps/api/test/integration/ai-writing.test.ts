import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '@influenceos/api-client';
import { clientFor, deleteUser, loginFresh, makeApp } from '../helpers.ts';

/**
 * P3.5 — AI writing help: a script draft from the brief, suggested notes on a
 * creator's draft, and a summary for the client report. Suggestions only,
 * behind the same switch and limit as every AI feature, keeping to each
 * reader's permissions and scope. Claude is replaced by a fake client.
 */
describe('P3.5 — AI writing help', () => {
  let app: FastifyInstance;
  let prisma: import('@influenceos/database').PrismaClient;
  let admin: Awaited<ReturnType<typeof clientFor>>;
  let noFinance: Awaited<ReturnType<typeof clientFor>>;
  let helper: Awaited<ReturnType<typeof clientFor>>;
  let outsider: Awaited<ReturnType<typeof clientFor>>;
  const users: string[] = [];
  const tag = `P35AI${Date.now()}`;
  let hadSettings: Awaited<ReturnType<typeof prisma.aiSettings.findUnique>>;
  let brandId: string;
  let otherBrandId: string;
  let influencerId: string;
  let campaignId: string;
  let otherCampaignId: string;
  let deliverableId: string;
  let scriptId: string;
  let otherScriptId: string;
  let submissionId: string;

  type Reply = {
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
    parsed_output: unknown;
  };
  const calls: { req: { system: string; messages: { content: unknown }[] } }[] = [];
  let next: () => Reply;
  const reply = (parsed_output: unknown): Reply => ({
    stop_reason: 'end_turn',
    usage: { input_tokens: 900, output_tokens: 300 },
    parsed_output,
  });
  /** The text of the last request sent to the AI. */
  const sent = () =>
    calls
      .at(-1)!
      .req.messages.map((m) =>
        typeof m.content === 'string'
          ? m.content
          : (m.content as { type: string; text?: string }[])
              .map((b) => b.text ?? `[${b.type}]`)
              .join('\n'),
      )
      .join('\n');

  async function status(p: Promise<unknown>) {
    try {
      await p;
      return 200;
    } catch (e) {
      return (e as ApiError).status;
    }
  }

  async function userClient(
    label: string,
    opts: {
      profile: 'GENERAL_MANAGER' | 'INFLUENCER_MANAGER';
      brandId: string;
      revoke?: 'FINANCE_VIEW';
    },
  ) {
    const { hash } = await import('@node-rs/argon2');
    const email = `${tag.toLowerCase()}_${label}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const user = await prisma.user.create({
      data: {
        email,
        name: `${tag} ${label}`,
        role: 'STAFF',
        roleProfile: opts.profile,
        passwordHash: await hash(password),
      },
    });
    users.push(user.id);
    await prisma.userBrandAccess.create({ data: { userId: user.id, brandId: opts.brandId } });
    if (opts.revoke) {
      await prisma.userCapability.create({
        data: { userId: user.id, capability: opts.revoke, granted: false },
      });
    }
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const { accessToken } = (res.json() as { tokens: { accessToken: string } }).tokens;
    return clientFor(app, { authorization: `Bearer ${accessToken}` });
  }

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
    await admin.ai.updateSettings({
      enabled: true,
      apiKey: `sk-ant-test-${tag}-key`,
      model: 'test-model',
      monthlyLimit: 100,
    });

    const { setAiClientFactory } = await import('@influenceos/domain');
    setAiClientFactory(
      () =>
        ({
          messages: {
            parse: async (req: (typeof calls)[number]['req']) => {
              calls.push({ req });
              return next();
            },
          },
        }) as never,
    );

    brandId = (
      await prisma.brand.create({ data: { name: `${tag} Glow`, slug: `${tag.toLowerCase()}-b` } })
    ).id;
    otherBrandId = (
      await prisma.brand.create({ data: { name: `${tag} Other`, slug: `${tag.toLowerCase()}-o` } })
    ).id;
    influencerId = (
      await prisma.influencer.create({ data: { displayName: `${tag} Noor`, countryCode: 'KW' } })
    ).id;
    campaignId = (
      await prisma.campaign.create({
        data: {
          brandId,
          name: `${tag} Serum launch`,
          slug: `${tag.toLowerCase()}-c`,
          brief:
            'Launch of the Glow vitamin C serum. Key message: brighter skin in 4 weeks of daily use.',
          currency: 'KWD',
        },
      })
    ).id;
    otherCampaignId = (
      await prisma.campaign.create({
        data: { brandId: otherBrandId, name: `${tag} Other`, slug: `${tag.toLowerCase()}-oc` },
      })
    ).id;
    const ci = await prisma.campaignInfluencer.create({
      data: {
        campaignId,
        influencerId,
        dealType: 'PAID',
        agreedCost: 450,
        participationStatus: 'CONFIRMED',
      },
    });
    const script = await prisma.scriptReference.create({
      data: {
        campaignId,
        title: 'Serum reel',
        approvedVersion: 1,
        versions: {
          create: {
            version: 1,
            body: 'Morning routine with the serum.',
            dos: ['Show the bottle'],
            status: 'APPROVED',
          },
        },
      },
    });
    scriptId = script.id;
    otherScriptId = (
      await prisma.scriptReference.create({ data: { campaignId: otherCampaignId, title: 'Other' } })
    ).id;
    deliverableId = (
      await prisma.deliverable.create({
        data: {
          campaignInfluencerId: ci.id,
          platform: 'INSTAGRAM',
          type: 'REEL',
          requirements: 'Film in daylight.',
          requiredHashtags: ['GlowKW'],
          requiredMentions: ['glowbrand'],
          scriptReferenceId: scriptId,
        },
      })
    ).id;
    submissionId = (
      await prisma.deliverableSubmission.create({
        data: {
          deliverableId,
          version: 1,
          caption: 'My new favourite serum #GlowKW',
          notes: 'First cut',
        },
      })
    ).id;

    noFinance = await userClient('gm', {
      profile: 'GENERAL_MANAGER',
      brandId,
      revoke: 'FINANCE_VIEW',
    });
    helper = await userClient('im', { profile: 'INFLUENCER_MANAGER', brandId });
    outsider = await userClient('out', { profile: 'GENERAL_MANAGER', brandId: otherBrandId });
  });

  beforeEach(() => {
    calls.length = 0;
  });

  afterAll(async () => {
    const { resetAiClientFactory } = await import('@influenceos/domain');
    resetAiClientFactory();
    await prisma.aiRequest.deleteMany({
      where: { campaignId: { in: [campaignId, otherCampaignId] } },
    });
    await prisma.brand.deleteMany({ where: { id: { in: [brandId, otherBrandId] } } });
    await prisma.influencer.deleteMany({ where: { id: influencerId } });
    await prisma.aiSettings.deleteMany({});
    if (hadSettings) await prisma.aiSettings.create({ data: hadSettings });
    await prisma.$disconnect();
    await app.close();
    for (const u of users) await deleteUser(u);
  });

  it('drafts a script from the brief, always keeping the required tags', async () => {
    next = () =>
      reply({
        body: '  Hook: my skin in 4 weeks…  ',
        captionSuggestion: 'Glowing ✨ #GlowKW @glowbrand #إعلان',
        talkingPoints: ['Daily use', '', 'Vitamin C'],
        dos: ['Natural light'],
        donts: ['No before/after claims'],
        hashtags: ['#skincare', 'glowkw'],
        mentions: [],
      });
    const draft = await admin.ai.draftScript(campaignId, {
      deliverableId,
      language: 'ar',
      instructions: 'Friendly tone',
    });
    expect(draft).toMatchObject({
      body: 'Hook: my skin in 4 weeks…',
      captionSuggestion: 'Glowing ✨ #GlowKW @glowbrand #إعلان',
      talkingPoints: ['Daily use', 'Vitamin C'],
      hashtags: ['GlowKW', 'skincare'],
      mentions: ['glowbrand'],
    });
    expect(typeof draft.remaining).toBe('number');
    // What was sent: the brief, the deliverable's requirements, the team's note, in Arabic.
    expect(calls[0]!.req.system).toContain('Write in Arabic');
    expect(sent()).toContain('brighter skin in 4 weeks');
    expect(sent()).toContain('Film in daylight.');
    expect(sent()).toContain('Friendly tone');
    const log = await prisma.aiRequest.findFirst({
      where: { campaignId, feature: 'SCRIPT_DRAFT' },
    });
    expect(log).toMatchObject({ status: 'OK', inputTokens: 900 });
  });

  it('drafts the next version of an existing script from its current text', async () => {
    next = () =>
      reply({
        body: 'v2',
        captionSuggestion: null,
        talkingPoints: [],
        dos: [],
        donts: [],
        hashtags: [],
        mentions: [],
      });
    const draft = await admin.ai.draftScript(campaignId, { scriptId, language: 'en' });
    expect(draft.hashtags).toEqual(['GlowKW']); // from the script's deliverable
    expect(sent()).toContain('Morning routine with the serum.');
    expect(sent()).toContain('Write the next version of this script.');
    // Another campaign's script, or its own deliverable elsewhere, isn't reachable.
    expect(
      await status(admin.ai.draftScript(campaignId, { scriptId: otherScriptId, language: 'en' })),
    ).toBe(404);
    expect(
      await status(admin.ai.draftScript(otherCampaignId, { deliverableId, language: 'en' })),
    ).toBe(404);
  });

  it('suggests review notes with the caption check, for reviewers only', async () => {
    next = () =>
      reply({
        summary: 'Good energy, a few fixes.',
        notes: ['Tag @glowbrand.', 'Add #إعلان.'],
        looksReady: true,
      });
    const review = await noFinance.ai.reviewDraft(submissionId, { language: 'en' });
    expect(review).toMatchObject({
      summary: 'Good energy, a few fixes.',
      notes: ['Tag @glowbrand.', 'Add #إعلان.'],
      looksReady: false, // there are notes, so not ready
      caption: { missingHashtags: [], missingMentions: ['@glowbrand'], disclosureMissing: true },
    });
    expect(sent()).toContain('My new favourite serum #GlowKW');
    expect(sent()).toContain('Morning routine with the serum.'); // the approved script
    expect(sent()).toContain('"adDisclosureMissing": true');
    expect(await status(helper.ai.reviewDraft(submissionId, { language: 'en' }))).toBe(403);
    expect(await status(outsider.ai.reviewDraft(submissionId, { language: 'en' }))).toBe(404);
  });

  it('summarises the report from the figures the reader may see', async () => {
    next = () => reply({ summary: ' Strong start for the serum launch. ' });
    const res = await admin.ai.summarizeReport(campaignId, { language: 'en' });
    expect(res.summary).toBe('Strong start for the serum launch.');
    expect(sent()).toContain('"spend": 450');

    // Without finance access the figures sent carry no costs.
    await noFinance.ai.summarizeReport(campaignId, { language: 'ar' });
    expect(calls.at(-1)!.req.system).toContain('in Arabic');
    expect(sent()).not.toContain('450');
    expect(sent()).toContain('"spend": null');

    expect(await status(helper.ai.summarizeReport(campaignId, { language: 'en' }))).toBe(403);
    expect(await status(outsider.ai.summarizeReport(campaignId, { language: 'en' }))).toBe(404);
    // Nothing was saved to the campaign.
    expect(
      (await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).reportSummary,
    ).toBeNull();
  });

  it('follows the writing-help switch and the scope rules before calling the AI', async () => {
    await admin.ai.updateSettings({ writingHelp: false });
    try {
      // One call at a time: a request started early would reject before it's awaited.
      for (const call of [
        () => admin.ai.draftScript(campaignId, { language: 'en' }),
        () => admin.ai.reviewDraft(submissionId, { language: 'en' }),
        () => admin.ai.summarizeReport(campaignId, { language: 'en' }),
      ]) {
        expect(await status(call())).toBe(409);
      }
      expect(calls).toHaveLength(0);
    } finally {
      await admin.ai.updateSettings({ writingHelp: true });
    }
    expect(await status(outsider.ai.draftScript(campaignId, { language: 'en' }))).toBe(404);
    expect(await status(helper.ai.draftScript(campaignId, { language: 'en' }))).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
