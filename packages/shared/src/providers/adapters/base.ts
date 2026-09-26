import type { Platform } from '../../constants/platforms';
import { resolveCapabilities } from '../capability-matrix';
import { buildEmbed } from '../embeds';
import {
  normalizeContentUrl as normalizeContentUrlFn,
  normalizeProfileInput as normalizeProfileInputFn,
  parseContentId as parseContentIdFn,
} from '../url';
import type {
  AdapterCapabilities,
  AdapterContext,
  AdapterResult,
  AvailabilityResult,
  ConnectionTestResult,
  ContentMetricsResult,
  EmbedDescriptor,
  NormalizedContentUrl,
  NormalizedProfileInput,
  ProfileSyncResult,
  RecentPost,
  ResolvedProfile,
  SocialPlatformAdapter,
  UnsupportedReason,
} from '../types';

/**
 * Shared adapter base. Provides the pure URL/embed helpers (identical across
 * platforms) and honest default implementations that return explicit
 * "manual fallback" results. Concrete adapters override only what their
 * platform genuinely supports.
 */
export abstract class BaseAdapter implements SocialPlatformAdapter {
  abstract readonly platform: Platform;
  protected readonly ctx: AdapterContext;

  constructor(ctx: AdapterContext = { credentials: {} }) {
    this.ctx = ctx;
  }

  protected get fetchFn(): typeof fetch {
    return this.ctx.fetchFn ?? fetch;
  }

  /** Whether the official API credential(s) for this platform are present. */
  abstract get apiConfigured(): boolean;

  getCapabilities(): AdapterCapabilities {
    return resolveCapabilities(this.platform, this.apiConfigured);
  }

  /**
   * Default for platforms without an official API we call: say so honestly
   * instead of claiming the provider was reached.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.apiConfigured) return { ok: false, live: false, message: 'No credential configured.' };
    return { ok: true, live: false, message: 'Credential is set. This platform has no test call.' };
  }

  /**
   * One GET against the provider with a 10-second limit, turned into a
   * connection-test result. `okWhen` decides success from the parsed body.
   */
  protected async probe(
    url: string,
    init: RequestInit | undefined,
    okWhen: (body: unknown) => boolean,
  ): Promise<ConnectionTestResult> {
    try {
      const res = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(10_000) });
      const body = (await res.json().catch(() => null)) as unknown;
      if (res.ok && okWhen(body)) {
        return { ok: true, live: true, httpStatus: res.status, message: 'Connected: the provider accepted the credential.' };
      }
      return { ok: false, live: true, httpStatus: res.status, message: providerErrorMessage(res.status, body) };
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return {
        ok: false,
        live: true,
        message: timedOut ? 'The provider did not answer within 10 seconds.' : 'Could not reach the provider.',
      };
    }
  }

  normalizeProfileInput(input: string): NormalizedProfileInput | null {
    return normalizeProfileInputFn(input, this.platform);
  }

  normalizeContentUrl(url: string): NormalizedContentUrl | null {
    return normalizeContentUrlFn(url);
  }

  parseContentId(url: string): string | null {
    return parseContentIdFn(url, this.platform);
  }

  getEmbed(url: string): EmbedDescriptor | null {
    return buildEmbed(url, this.platform);
  }

  // --- Honest defaults: manual fallback -----------------------------------

  async resolveProfile(
    input: NormalizedProfileInput,
  ): Promise<AdapterResult<ResolvedProfile>> {
    return this.manualFallback('NOT_SUPPORTED_BY_PLATFORM', input.profileUrl);
  }

  async syncProfile(_account: {
    username: string;
    profileUrl?: string | null;
    platformUserId?: string | null;
  }): Promise<AdapterResult<ProfileSyncResult>> {
    return this.manualFallback('NOT_SUPPORTED_BY_PLATFORM');
  }

  async syncContentMetrics(_content: {
    externalId: string | null;
    originalUrl: string;
    ownerUsername?: string | null;
  }): Promise<AdapterResult<ContentMetricsResult>> {
    return this.manualFallback('NOT_SUPPORTED_BY_PLATFORM');
  }

  async checkContentAvailability(content: {
    externalId: string | null;
    originalUrl: string;
  }): Promise<AvailabilityResult> {
    return this.headCheck(content.originalUrl);
  }

  async listRecentPosts(_account: {
    username: string;
    platformUserId?: string | null;
  }): Promise<AdapterResult<RecentPost[]>> {
    return this.manualFallback('NOT_SUPPORTED_BY_PLATFORM');
  }

  // --- Helpers ------------------------------------------------------------

  protected manualFallback(
    reason: UnsupportedReason,
    _profileUrl?: string,
  ): AdapterResult<never> {
    const messages: Record<UnsupportedReason, string> = {
      NO_CREDENTIAL: `No API credential configured for ${this.platform}. Enter data manually.`,
      REQUIRES_CREATOR_AUTHORIZATION: `${this.platform} requires creator authorization which this product does not perform. Enter data manually.`,
      REQUIRES_APP_AUTHORIZATION: `${this.platform} requires app authorization/review. Enter data manually.`,
      NOT_SUPPORTED_BY_PLATFORM: `${this.platform} does not expose this data publicly. Enter data manually.`,
      ACCOUNT_NOT_ELIGIBLE: `This ${this.platform} account is not eligible for official API access. Enter data manually.`,
      RATE_LIMITED: `${this.platform} rate limit reached. Try again later.`,
      PROVIDER_ERROR: `${this.platform} request failed. Enter data manually or retry.`,
      NOT_FOUND: `${this.platform} profile/content not found.`,
      INVALID_INPUT: `Could not understand the ${this.platform} input.`,
    };
    return {
      ok: false,
      reason,
      message: messages[reason],
      fallback: reason === 'NOT_FOUND' || reason === 'INVALID_INPUT' ? null : 'MANUAL',
      retryable: reason === 'RATE_LIMITED' || reason === 'PROVIDER_ERROR',
    };
  }

  /**
   * Best-effort availability check via a lightweight request. Many platforms
   * return 200 even for removed content (soft 404) so this only reliably
   * detects hard failures (network / 4xx / 5xx). Adapters with an official
   * status API should override this.
   */
  protected async headCheck(url: string): Promise<AvailabilityResult> {
    try {
      const res = await this.fetchFn(url, { method: 'GET', redirect: 'follow' });
      if (res.status === 404 || res.status === 410) {
        return { status: 'REMOVED', httpStatus: res.status, checkedVia: 'HEAD_REQUEST' };
      }
      if (res.status === 401 || res.status === 403) {
        return { status: 'PRIVATE', httpStatus: res.status, checkedVia: 'HEAD_REQUEST' };
      }
      if (res.status >= 500) {
        return {
          status: 'UNKNOWN',
          httpStatus: res.status,
          checkedVia: 'HEAD_REQUEST',
          message: 'Upstream error',
        };
      }
      return { status: 'LIVE', httpStatus: res.status, checkedVia: 'HEAD_REQUEST' };
    } catch (err) {
      return {
        status: 'UNKNOWN',
        checkedVia: 'HEAD_REQUEST',
        message: err instanceof Error ? err.message : 'Request failed',
      };
    }
  }

  protected async oembedCheck(oembedUrl: string): Promise<AvailabilityResult> {
    try {
      const res = await this.fetchFn(oembedUrl, { method: 'GET' });
      if (res.ok) return { status: 'LIVE', httpStatus: res.status, checkedVia: 'OEMBED' };
      if (res.status === 404) return { status: 'REMOVED', httpStatus: 404, checkedVia: 'OEMBED' };
      if (res.status === 401 || res.status === 403) {
        return { status: 'PRIVATE', httpStatus: res.status, checkedVia: 'OEMBED' };
      }
      return { status: 'UNAVAILABLE', httpStatus: res.status, checkedVia: 'OEMBED' };
    } catch (err) {
      return {
        status: 'UNKNOWN',
        checkedVia: 'OEMBED',
        message: err instanceof Error ? err.message : 'Request failed',
      };
    }
  }
}

/** A short, safe message from a provider error response (never echoes secrets). */
function providerErrorMessage(status: number, body: unknown): string {
  const b = body as { error?: { message?: unknown } | string; detail?: unknown; title?: unknown } | null;
  const raw =
    (b && typeof b.error === 'object' && typeof b.error?.message === 'string' && b.error.message) ||
    (b && typeof b.error === 'string' && b.error) ||
    (b && typeof b.detail === 'string' && b.detail) ||
    (b && typeof b.title === 'string' && b.title) ||
    '';
  const reason = status === 401 || status === 403 ? 'The provider refused the credential' : status === 429 ? 'Rate limited by the provider' : `The provider answered ${status}`;
  // Tokens can appear in echoed URLs; keep only a short prefix of the text.
  const detail = raw.replace(/access_token=[^&\s]+/gi, 'access_token=…').slice(0, 200);
  return detail ? `${reason}: ${detail}` : `${reason}.`;
}
