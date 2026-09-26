import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z4 from 'zod/v4';
import type {
  AiFeature,
  AiSettingsDTO,
  AiStatusDTO,
  AudienceReadDTO,
  MetricsReadDTO,
  requests,
  z,
} from '@influenceos/contracts';
import { COUNTRIES } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireActor, requireAdmin, requireCapability } from '../lib/authz';
import { aiAvailable, aiUsedThisMonth, currentAiMonth, resolveAiSettings, withAi } from '../lib/ai';
import { seal } from '../lib/crypto';
import { iso, logActivity } from '../lib/helpers';
import { getStorage } from '../lib/storage';
import { makeContentService } from './content.service';
import { makeInfluencerService } from './influencer.service';

/** The API takes images up to 5 MB. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const READABLE_IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
type ReadableImage = (typeof READABLE_IMAGES)[number];

/** What the model returns for a screenshot — every number optional (null = not shown). */
const ScreenshotReading = z4.object({
  looksLikeInsights: z4.boolean(),
  views: z4.number().int().nullable(),
  likes: z4.number().int().nullable(),
  comments: z4.number().int().nullable(),
  shares: z4.number().int().nullable(),
  saves: z4.number().int().nullable(),
  capturedOn: z4.string().nullable(),
  note: z4.string().nullable(),
});

const SCREENSHOT_PROMPT = `You read a social media post's numbers from a screenshot of its insights (analytics) screen — Instagram, TikTok, Snapchat, YouTube, X or Facebook, in English or Arabic.

Return only numbers you can actually read on the screen; use null for anything not shown. Never estimate, add up or work a number out.
- views: views or plays (Arabic: مشاهدات). Don't use reach, impressions or accounts reached as views unless the screen itself calls them views.
- likes (إعجابات), comments (تعليقات), shares (مشاركات / إرسال), saves (حفظ / عمليات الحفظ).
- Write whole numbers: 12.3K → 12300, 1.2M → 1200000, "١٢٬٣٠٠" → 12300.
- capturedOn: the date these numbers were for (YYYY-MM-DD) only when the screen clearly shows it, such as an "as of" date or the phone's date. Not the post's publish date. Otherwise null.
- looksLikeInsights: false if the image isn't a post's insights or stats screen; then return null for every number.
- note: one short sentence about anything the person should double-check (a number cut off or blurry, the screen showing a different post, figures for a period rather than the post), or null. Write it in {language}.`;

/** What the model returns for an audience screenshot — shares as percentages, null when not shown. */
const AudienceReading = z4.object({
  looksLikeAudience: z4.boolean(),
  countries: z4.array(z4.object({ countryCode: z4.string(), pct: z4.number() })),
  femalePct: z4.number().nullable(),
  malePct: z4.number().nullable(),
  age13to17: z4.number().nullable(),
  age18to24: z4.number().nullable(),
  age25to34: z4.number().nullable(),
  age35to44: z4.number().nullable(),
  age45to54: z4.number().nullable(),
  age55to64: z4.number().nullable(),
  age55plus: z4.number().nullable(),
  age65plus: z4.number().nullable(),
  engagementRate: z4.number().nullable(),
  capturedOn: z4.string().nullable(),
  note: z4.string().nullable(),
});

const AUDIENCE_PROMPT = `You read a creator's audience (followers) breakdown from a screenshot of their account insights — Instagram, TikTok, Snapchat, YouTube or X, in English or Arabic.

Return only what you can actually read on the screen; use null (or an empty list) for anything not shown. Never estimate or work a figure out.
- countries: the top countries/locations with their share of the audience in percent, as ISO 3166-1 alpha-2 codes (Kuwait → KW, Saudi Arabia / السعودية → SA, United Arab Emirates / الإمارات → AE, Egypt / مصر → EG). Cities are not countries: skip them. At most 10.
- femalePct / malePct: women (نساء / إناث) and men (رجال / ذكور) in percent.
- Age groups in percent, each in the field for exactly the range the screen shows: 13-17, 18-24, 25-34, 35-44, 45-54, 55-64, 65+; a "55+" group goes in age55plus. Leave groups the screen doesn't show as null.
- engagementRate: the engagement rate in percent only when the screen shows one.
- Percent values are numbers such as 42.5 for 42.5%. Arabic digits count too ("٤٢٫٥٪" → 42.5).
- capturedOn: the date or end of the period these figures are for (YYYY-MM-DD), only when the screen clearly shows it. Otherwise null.
- looksLikeAudience: false if the image isn't an audience/followers breakdown; then return nulls and an empty list.
- note: one short sentence about anything the person should double-check (a figure cut off, only part of the list visible, a different account), or null. Write it in {language}.`;

const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));

/** A read share, kept only when it's a real percentage. */
function pct(v: number | null): number | null {
  return v != null && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v * 10) / 10 : null;
}

/** 45 and over: the screen's older groups added up (none shown → null). */
function olderShare(v: z4.infer<typeof AudienceReading>): number | null {
  const parts = [v.age45to54, v.age55to64, v.age55plus, v.age65plus].map(pct).filter((x): x is number => x != null);
  if (parts.length === 0) return null;
  return pct(parts.reduce((a, b) => a + b, 0));
}

type ReadInput = z.infer<typeof requests.readMetricsScreenshotSchema>;
type AudienceReadInput = z.infer<typeof requests.readAudienceScreenshotSchema>;
type SettingsUpdate = z.infer<typeof requests.aiSettingsUpdateSchema>;

/** A read number is kept only when it's a sane count. */
function count(v: number | null): number | null {
  return v != null && Number.isInteger(v) && v >= 0 && v < 1e12 ? v : null;
}

/** A date the screenshot shows, kept only when it's real and not in the future. */
function screenshotDate(v: string | null, now = new Date()): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  if (d.getTime() > now.getTime() + 864e5 || d.getUTCFullYear() < 2010) return null;
  return v;
}

function last4(key: string | null): string | null {
  return key ? key.slice(-4) : null;
}

/**
 * AI assistance (P3.2): the switch and limits admins control, what the app
 * shows about it, and reading a post's numbers from its insights screenshot.
 * The writing helpers (P3.5) use the same switch and limit through withAi.
 */
export function makeAiService(ctx: DomainContext) {
  const { prisma } = ctx;

  async function status(): Promise<AiStatusDTO> {
    requireActor(ctx);
    const s = await resolveAiSettings(prisma);
    const available = aiAvailable(s);
    return {
      available,
      readScreenshots: available && s.readScreenshots,
      writingHelp: available && s.writingHelp,
      remaining: available ? Math.max(0, s.monthlyLimit - (await aiUsedThisMonth(prisma))) : null,
    };
  }

  async function settings(): Promise<AiSettingsDTO> {
    requireAdmin(ctx);
    const s = await resolveAiSettings(prisma);
    const month = currentAiMonth();
    const since = { createdAt: { gte: month.start } };
    const [byFeature, failed] = await Promise.all([
      prisma.aiRequest.groupBy({
        by: ['feature'],
        where: { ...since, status: { in: ['OK', 'REFUSED'] } },
        _count: { _all: true },
      }),
      prisma.aiRequest.count({ where: { ...since, status: 'FAILED' } }),
    ]);
    return {
      enabled: s.enabled,
      model: s.model,
      modelSource: s.modelSource,
      apiKey: { source: s.apiKeySource, last4: last4(s.apiKey) },
      monthlyLimit: s.monthlyLimit,
      readScreenshots: s.readScreenshots,
      writingHelp: s.writingHelp,
      available: aiAvailable(s),
      usage: {
        month: month.key,
        used: byFeature.reduce((sum, r) => sum + r._count._all, 0),
        failed,
        byFeature: byFeature
          .map((r) => ({ feature: r.feature as AiFeature, count: r._count._all }))
          .sort((a, b) => b.count - a.count),
      },
      updatedAt: s.updatedAt ? iso(s.updatedAt) : null,
    };
  }

  async function updateSettings(input: SettingsUpdate): Promise<AiSettingsDTO> {
    const actor = requireAdmin(ctx);
    const data = {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.model !== undefined ? { model: input.model || null } : {}),
      ...(input.apiKey !== undefined
        ? { sealedApiKey: input.apiKey ? seal(input.apiKey) : null }
        : {}),
      ...(input.monthlyLimit !== undefined ? { monthlyLimit: input.monthlyLimit } : {}),
      ...(input.readScreenshots !== undefined ? { readScreenshots: input.readScreenshots } : {}),
      ...(input.writingHelp !== undefined ? { writingHelp: input.writingHelp } : {}),
      updatedById: actor.id,
    };
    await prisma.$transaction(async (tx) => {
      await tx.aiSettings.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', ...data },
        update: data,
      });
      const after = await resolveAiSettings(tx);
      if (after.enabled && (!after.apiKey || !after.model)) {
        throw AppError.validation('Add a Claude API key and a model ID before turning AI on.');
      }
    });
    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} changed the AI settings.`,
      meta: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.apiKey !== undefined ? { apiKey: input.apiKey ? 'replaced' : 'removed' } : {}),
        ...(input.monthlyLimit !== undefined ? { monthlyLimit: input.monthlyLimit } : {}),
        ...(input.readScreenshots !== undefined ? { readScreenshots: input.readScreenshots } : {}),
        ...(input.writingHelp !== undefined ? { writingHelp: input.writingHelp } : {}),
      },
    });
    return settings();
  }

  /**
   * Read a post's numbers from one of its attached insights screenshots.
   * Returns suggestions for the metrics form — nothing is saved here.
   */
  async function readScreenshot(contentId: string, input: ReadInput): Promise<MetricsReadDTO> {
    await requireCapability(ctx, 'CONTENT_MANAGE');
    // Not found when the post is outside the reader's brands or countries.
    const content = await makeContentService(ctx).detail(contentId);
    const file = await prisma.attachment.findUnique({ where: { id: input.attachmentId } });
    if (!file || file.publishedContentId !== contentId) throw AppError.notFound('Attachment');
    if (!READABLE_IMAGES.includes(file.mimeType as ReadableImage)) {
      throw AppError.badRequest('Only PNG, JPEG, WebP or GIF screenshots can be read.');
    }
    if (file.sizeBytes > MAX_IMAGE_BYTES) {
      throw AppError.badRequest('This screenshot is too big to read (over 5 MB).');
    }
    const bytes = await getStorage().read(file.storageKey);
    if (!bytes) throw AppError.notFound('Attachment');
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw AppError.badRequest('This screenshot is too big to read (over 5 MB).');
    }

    const { value, remaining } = await withAi(
      ctx,
      {
        feature: 'READ_SCREENSHOT',
        campaignId: content.campaign?.id ?? null,
        publishedContentId: contentId,
      },
      async (client, model) => {
        const res = await client.messages.parse({
          model,
          max_tokens: 4096,
          system: SCREENSHOT_PROMPT.replace(
            '{language}',
            input.locale === 'ar' ? 'Arabic' : 'English',
          ),
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: file.mimeType as ReadableImage,
                    data: bytes.toString('base64'),
                  },
                },
                {
                  type: 'text',
                  text: `The post is on ${content.platform}. Read its numbers from this screenshot.`,
                },
              ],
            },
          ],
          output_config: { format: zodOutputFormat(ScreenshotReading) },
        });
        return { stopReason: res.stop_reason, usage: res.usage, value: res.parsed_output };
      },
    );

    const looksLikeInsights = value.looksLikeInsights;
    const note = value.note?.trim().slice(0, 300) || null;
    return {
      values: {
        views: looksLikeInsights ? count(value.views) : null,
        likes: looksLikeInsights ? count(value.likes) : null,
        comments: looksLikeInsights ? count(value.comments) : null,
        shares: looksLikeInsights ? count(value.shares) : null,
        saves: looksLikeInsights ? count(value.saves) : null,
      },
      capturedOn: looksLikeInsights ? screenshotDate(value.capturedOn) : null,
      looksLikeInsights,
      note,
      remaining,
    };
  }

  /**
   * Read a creator's audience breakdown from one of their own screenshots,
   * to fill the audience form for a person to check and save.
   */
  async function readAudienceScreenshot(influencerId: string, input: AudienceReadInput): Promise<AudienceReadDTO> {
    await requireCapability(ctx, 'INFLUENCERS_MANAGE');
    // Not found when the creator is outside the reader's brands or countries.
    const creator = await makeInfluencerService(ctx).detail(influencerId);
    const file = await prisma.attachment.findUnique({ where: { id: input.attachmentId } });
    if (!file || file.influencerId !== influencerId) throw AppError.notFound('Attachment');
    if (!READABLE_IMAGES.includes(file.mimeType as ReadableImage)) {
      throw AppError.badRequest('Only PNG, JPEG, WebP or GIF screenshots can be read.');
    }
    if (file.sizeBytes > MAX_IMAGE_BYTES) {
      throw AppError.badRequest('This screenshot is too big to read (over 5 MB).');
    }
    const bytes = await getStorage().read(file.storageKey);
    if (!bytes) throw AppError.notFound('Attachment');
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw AppError.badRequest('This screenshot is too big to read (over 5 MB).');
    }
    const account = input.socialAccountId
      ? creator.socialAccounts.find((a) => a.id === input.socialAccountId)
      : undefined;
    if (input.socialAccountId && !account) throw AppError.notFound('Social account');

    const { value, remaining } = await withAi(ctx, { feature: 'READ_SCREENSHOT' }, async (client, model) => {
      const res = await client.messages.parse({
        model,
        max_tokens: 4096,
        system: AUDIENCE_PROMPT.replace('{language}', input.locale === 'ar' ? 'Arabic' : 'English'),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: file.mimeType as ReadableImage,
                  data: bytes.toString('base64'),
                },
              },
              {
                type: 'text',
                text: account
                  ? `This is the audience of the creator's ${account.platform} account. Read the breakdown from this screenshot.`
                  : "Read the creator's audience breakdown from this screenshot.",
              },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(AudienceReading) },
      });
      return { stopReason: res.stop_reason, usage: res.usage, value: res.parsed_output };
    });

    const ok = value.looksLikeAudience;
    const seen = new Set<string>();
    const countries = ok
      ? value.countries
          .map((c) => ({ countryCode: c.countryCode.trim().toUpperCase(), pct: pct(c.pct) }))
          .filter((c): c is { countryCode: string; pct: number } => {
            if (c.pct == null || !COUNTRY_CODES.has(c.countryCode) || seen.has(c.countryCode)) return false;
            seen.add(c.countryCode);
            return true;
          })
          .sort((a, b) => b.pct - a.pct)
          .slice(0, 10)
      : [];
    return {
      values: {
        countries,
        femalePct: ok ? pct(value.femalePct) : null,
        malePct: ok ? pct(value.malePct) : null,
        ages: {
          age13to17Pct: ok ? pct(value.age13to17) : null,
          age18to24Pct: ok ? pct(value.age18to24) : null,
          age25to34Pct: ok ? pct(value.age25to34) : null,
          age35to44Pct: ok ? pct(value.age35to44) : null,
          age45PlusPct: ok ? olderShare(value) : null,
        },
        engagementRate: ok ? pct(value.engagementRate) : null,
      },
      capturedOn: ok ? screenshotDate(value.capturedOn) : null,
      looksLikeAudience: ok,
      note: value.note?.trim().slice(0, 300) || null,
      remaining,
    };
  }

  return { status, settings, updateSettings, readScreenshot, readAudienceScreenshot };
}

export type AiService = ReturnType<typeof makeAiService>;
