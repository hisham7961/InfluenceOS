import { BaseAdapter } from './base';
import type {
  AdapterResult,
  AvailabilityResult,
  ContentMetricsResult,
  NormalizedProfileInput,
  ProfileSyncResult,
  ResolvedProfile,
} from '../types';

const API = 'https://api.twitter.com/2';

/**
 * X (Twitter) adapter — uses X API v2 (bearer token) for public profile and
 * tweet data where the access tier permits, and the official tweet iframe for
 * embeds. Availability falls back to the public oEmbed endpoint. Fully manual
 * when no bearer token is configured.
 */
export class XAdapter extends BaseAdapter {
  readonly platform = 'X' as const;

  get bearer(): string | undefined {
    return this.ctx.credentials.X_API_BEARER_TOKEN || undefined;
  }

  get apiConfigured(): boolean {
    return !!this.bearer;
  }

  private async getJson(url: string): Promise<any> {
    const res = await this.fetchFn(url, {
      headers: { Authorization: `Bearer ${this.bearer}` },
    });
    if (res.status === 429) throw Object.assign(new Error('rate limited'), { code: 429 });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: res.status });
    return res.json();
  }

  override async resolveProfile(
    input: NormalizedProfileInput,
  ): Promise<AdapterResult<ResolvedProfile>> {
    if (!this.apiConfigured) return this.manualFallback('NO_CREDENTIAL');
    try {
      const data = await this.getJson(
        `${API}/users/by/username/${encodeURIComponent(input.username)}?user.fields=public_metrics,profile_image_url,verified,description`,
      );
      const u = data.data;
      if (!u) return this.manualFallback('NOT_FOUND');
      const m = u.public_metrics ?? {};
      return {
        ok: true,
        source: 'OFFICIAL_API',
        data: {
          platform: 'X',
          username: input.username,
          profileUrl: input.profileUrl,
          displayName: u.name ?? null,
          avatarUrl: u.profile_image_url?.replace('_normal', '') ?? null,
          bio: u.description ?? null,
          followers: m.followers_count ?? null,
          following: m.following_count ?? null,
          postCount: m.tweet_count ?? null,
          isVerified: u.verified ?? null,
          platformUserId: u.id ?? null,
          raw: u,
        },
      };
    } catch (err: any) {
      if (err?.code === 429) return this.manualFallback('RATE_LIMITED');
      if (err?.code === 403) return this.manualFallback('REQUIRES_APP_AUTHORIZATION');
      return this.manualFallback('PROVIDER_ERROR');
    }
  }

  override async syncProfile(account: {
    username: string;
    platformUserId?: string | null;
  }): Promise<AdapterResult<ProfileSyncResult>> {
    const res = await this.resolveProfile({
      platform: 'X',
      username: account.username,
      profileUrl: `https://x.com/${account.username}`,
    });
    if (!res.ok) return res;
    return {
      ok: true,
      source: 'OFFICIAL_API',
      data: {
        followers: res.data.followers ?? null,
        following: res.data.following ?? null,
        postCount: res.data.postCount ?? null,
        isVerified: res.data.isVerified ?? null,
        avatarUrl: res.data.avatarUrl ?? null,
        displayName: res.data.displayName ?? null,
        raw: res.data.raw,
      },
    };
  }

  override async syncContentMetrics(content: {
    externalId: string | null;
  }): Promise<AdapterResult<ContentMetricsResult>> {
    if (!this.apiConfigured) return this.manualFallback('NO_CREDENTIAL');
    if (!content.externalId) return this.manualFallback('INVALID_INPUT');
    try {
      const data = await this.getJson(
        `${API}/tweets/${encodeURIComponent(content.externalId)}?tweet.fields=public_metrics`,
      );
      const m = data.data?.public_metrics;
      if (!m) return this.manualFallback('NOT_FOUND');
      return {
        ok: true,
        source: 'OFFICIAL_API',
        data: {
          likes: m.like_count ?? null,
          comments: m.reply_count ?? null,
          reposts: m.retweet_count ?? null,
          shares: m.quote_count ?? null,
          views: m.impression_count ?? null,
          raw: m,
        },
      };
    } catch (err: any) {
      if (err?.code === 429) return this.manualFallback('RATE_LIMITED');
      return this.manualFallback('PROVIDER_ERROR');
    }
  }

  override async checkContentAvailability(content: {
    originalUrl: string;
  }): Promise<AvailabilityResult> {
    // Public oEmbed endpoint: returns 404 for deleted, 403 for protected.
    return this.oembedCheck(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(content.originalUrl)}`,
    );
  }
}
