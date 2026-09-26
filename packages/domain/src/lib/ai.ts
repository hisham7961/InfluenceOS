import Anthropic from '@anthropic-ai/sdk';
import type { AiFeature } from '@influenceos/contracts';
import { businessDateKey, startOfBusinessDay } from '@influenceos/shared';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { open } from './crypto';

/**
 * AI assistance (P3.2 / P3.5) — every call to Claude goes through here.
 *
 * Nothing is called until an admin switches AI on in Settings with an API key
 * and a model (or ANTHROPIC_API_KEY / AI_MODEL in the environment). Each call
 * is logged (who, what for, tokens — never the text or image) and counted
 * against a monthly limit; answered and declined calls count, failed ones
 * don't. Answers are suggestions: the features using them never save anything
 * without a person confirming.
 */

export type AiClient = Pick<Anthropic, 'messages'>;

let clientFactory: (apiKey: string) => AiClient = (apiKey) =>
  new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });

/** Tests swap in a fake client; nothing else should. */
export function setAiClientFactory(factory: (apiKey: string) => AiClient): void {
  clientFactory = factory;
}

export function resetAiClientFactory(): void {
  clientFactory = (apiKey) => new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });
}

export interface ResolvedAiSettings {
  enabled: boolean;
  model: string | null;
  modelSource: 'SETTINGS' | 'ENV' | 'NONE';
  apiKey: string | null;
  apiKeySource: 'SETTINGS' | 'ENV' | 'NONE';
  monthlyLimit: number;
  readScreenshots: boolean;
  writingHelp: boolean;
  updatedAt: Date | null;
}

export async function resolveAiSettings(
  prisma: Pick<DomainContext['prisma'], 'aiSettings'>,
): Promise<ResolvedAiSettings> {
  const row = await prisma.aiSettings.findUnique({ where: { id: 'singleton' } });
  const storedKey = row?.sealedApiKey ? open(row.sealedApiKey) : null;
  const envKey = process.env.ANTHROPIC_API_KEY?.trim() || null;
  const envModel = process.env.AI_MODEL?.trim() || null;
  return {
    enabled: row?.enabled ?? false,
    model: row?.model || envModel,
    modelSource: row?.model ? 'SETTINGS' : envModel ? 'ENV' : 'NONE',
    apiKey: storedKey || envKey,
    apiKeySource: storedKey ? 'SETTINGS' : envKey ? 'ENV' : 'NONE',
    monthlyLimit: row?.monthlyLimit ?? 300,
    readScreenshots: row?.readScreenshots ?? true,
    writingHelp: row?.writingHelp ?? true,
    updatedAt: row?.updatedAt ?? null,
  };
}

export function aiAvailable(s: ResolvedAiSettings): boolean {
  return s.enabled && Boolean(s.apiKey) && Boolean(s.model);
}

/** The current calendar month in Kuwait time: its key (YYYY-MM) and first moment. */
export function currentAiMonth(now = new Date()): { key: string; start: Date } {
  const key = businessDateKey(now).slice(0, 7);
  return { key, start: startOfBusinessDay(`${key}-01`) };
}

/** Requests that count against the limit this month. */
export async function aiUsedThisMonth(
  prisma: DomainContext['prisma'],
  now = new Date(),
): Promise<number> {
  return prisma.aiRequest.count({
    where: { createdAt: { gte: currentAiMonth(now).start }, status: { in: ['OK', 'REFUSED'] } },
  });
}

export interface AiCallContext {
  feature: AiFeature;
  campaignId?: string | null;
  publishedContentId?: string | null;
}

export type AiUsage = { input_tokens: number; output_tokens: number } | null | undefined;

/**
 * Run one Claude call for a feature: checks the switch, the feature toggle and
 * the monthly limit first; logs the outcome; turns API failures into clear,
 * translated errors. `run` gets a ready client and the model and returns the
 * response (with its stop reason and usage) plus the value to hand back.
 */
export async function withAi<T>(
  ctx: DomainContext,
  call: AiCallContext,
  run: (
    client: AiClient,
    model: string,
  ) => Promise<{ stopReason: string | null | undefined; usage: AiUsage; value: T | null }>,
): Promise<{ value: T; remaining: number }> {
  const { prisma } = ctx;
  const settings = await resolveAiSettings(prisma);
  if (!aiAvailable(settings))
    throw AppError.conflict(
      'AI assistance is turned off. An admin can turn it on in Settings → AI.',
    );
  const featureOn =
    call.feature === 'READ_SCREENSHOT' ? settings.readScreenshots : settings.writingHelp;
  if (!featureOn) throw AppError.conflict('This AI feature is turned off in Settings → AI.');
  const used = await aiUsedThisMonth(prisma);
  if (used >= settings.monthlyLimit) {
    throw AppError.conflict(
      "This month's AI requests are used up. An admin can raise the limit in Settings → AI.",
    );
  }

  const log = (status: 'OK' | 'REFUSED' | 'FAILED', usage: AiUsage, error?: string) =>
    prisma.aiRequest.create({
      data: {
        feature: call.feature,
        status,
        userId: ctx.actor?.id ?? null,
        campaignId: call.campaignId ?? null,
        publishedContentId: call.publishedContentId ?? null,
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
        error: error ? error.slice(0, 500) : null,
      },
    });

  let result: Awaited<ReturnType<typeof run>>;
  try {
    result = await run(clientFactory(settings.apiKey!), settings.model!);
  } catch (e) {
    await log('FAILED', null, e instanceof Error ? e.message : String(e));
    if (
      e instanceof Anthropic.AuthenticationError ||
      e instanceof Anthropic.PermissionDeniedError
    ) {
      throw AppError.badRequest(
        'The Claude API key was refused. An admin can check it in Settings → AI.',
      );
    }
    if (e instanceof Anthropic.NotFoundError) {
      throw AppError.badRequest(
        'The AI model in Settings → AI was not found. An admin can check the model ID.',
      );
    }
    if (e instanceof Anthropic.RateLimitError) {
      throw AppError.badRequest('The AI service is busy. Try again in a minute.');
    }
    if (e instanceof Anthropic.BadRequestError) {
      throw AppError.badRequest('The AI service could not take this request.');
    }
    throw AppError.badRequest("The AI service didn't answer. Try again.");
  }

  if (result.stopReason === 'refusal') {
    await log('REFUSED', result.usage);
    throw AppError.badRequest('The AI declined this request.');
  }
  if (result.value == null) {
    // Cut off (max_tokens) or an answer that didn't match what was asked for.
    await log('FAILED', result.usage, `no usable answer (stop: ${result.stopReason ?? 'unknown'})`);
    throw AppError.badRequest("The AI answer couldn't be used. Try again.");
  }
  await log('OK', result.usage);
  return { value: result.value, remaining: Math.max(0, settings.monthlyLimit - used - 1) };
}
