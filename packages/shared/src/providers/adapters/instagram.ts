import { BaseAdapter } from './base';
import type {
  AdapterResult,
  AvailabilityResult,
  NormalizedProfileInput,
  ResolvedProfile,
} from '../types';

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Instagram adapter — the Instagram Graph API only exposes data for eligible
 * Professional (Business/Creator) accounts reached through the Business
 * Discovery edge, which itself requires a connected IG Business account id and
 * a Meta app access token. When those are configured we attempt Business
 * Discovery; otherwise the adapter is manual, and content always uses the
 * official Instagram embed iframe (handled by the base class).
 */
export class InstagramAdapter extends BaseAdapter {
  readonly platform = 'INSTAGRAM' as const;

  get accessToken(): string | undefined {
    return this.ctx.credentials.INSTAGRAM_ACCESS_TOKEN || undefined;
  }

  /** The business account id used as the "self" node for Business Discovery. */
  get igUserId(): string | undefined {
    return this.ctx.credentials.INSTAGRAM_BUSINESS_ACCOUNT_ID || undefined;
  }

  get apiConfigured(): boolean {
    return !!this.accessToken && !!this.igUserId;
  }

  override async resolveProfile(
    input: NormalizedProfileInput,
  ): Promise<AdapterResult<ResolvedProfile>> {
    if (!this.apiConfigured) {
      // Honest: personal accounts are never resolvable; even Professional
      // accounts require our own connected IG business id + app token.
      return this.manualFallback('REQUIRES_APP_AUTHORIZATION');
    }
    try {
      const fields =
        'business_discovery.username(' +
        encodeURIComponent(input.username) +
        '){username,name,biography,followers_count,follows_count,media_count,profile_picture_url}';
      const res = await this.fetchFn(
        `${GRAPH}/${this.igUserId}?fields=${fields}&access_token=${this.accessToken}`,
      );
      if (res.status === 400) return this.manualFallback('ACCOUNT_NOT_ELIGIBLE');
      if (!res.ok) return this.manualFallback('PROVIDER_ERROR');
      const data = await res.json();
      const bd = data.business_discovery;
      if (!bd) return this.manualFallback('ACCOUNT_NOT_ELIGIBLE');
      return {
        ok: true,
        source: 'OFFICIAL_API',
        data: {
          platform: 'INSTAGRAM',
          username: bd.username ?? input.username,
          profileUrl: input.profileUrl,
          displayName: bd.name ?? null,
          avatarUrl: bd.profile_picture_url ?? null,
          bio: bd.biography ?? null,
          followers: bd.followers_count ?? null,
          following: bd.follows_count ?? null,
          postCount: bd.media_count ?? null,
          isVerified: null,
          platformUserId: bd.id ?? null,
          raw: bd,
        },
      };
    } catch {
      return this.manualFallback('PROVIDER_ERROR');
    }
  }

  override async checkContentAvailability(content: {
    originalUrl: string;
  }): Promise<AvailabilityResult> {
    // The Instagram embed endpoint responds regardless of login for public
    // posts; a hard failure indicates removal. Best-effort only.
    return this.headCheck(content.originalUrl.replace(/\/?$/, '/embed'));
  }
}
