import { BaseAdapter } from './base';
import type {
  AdapterResult,
  AvailabilityResult,
  ContentMetricsResult,
  NormalizedProfileInput,
  ProfileSyncResult,
  ResolvedProfile,
} from '../types';

const API = 'https://www.googleapis.com/youtube/v3';

/**
 * YouTube adapter — uses the official YouTube Data API v3 (API key) for public
 * channel and video statistics. Fully manual when no key is configured.
 */
export class YouTubeAdapter extends BaseAdapter {
  readonly platform = 'YOUTUBE' as const;

  get apiKey(): string | undefined {
    return this.ctx.credentials.YOUTUBE_API_KEY || undefined;
  }

  get apiConfigured(): boolean {
    return !!this.apiKey;
  }

  private async getJson(url: string): Promise<any> {
    const res = await this.fetchFn(url);
    if (res.status === 403) throw Object.assign(new Error('quota/forbidden'), { code: 403 });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: res.status });
    return res.json();
  }

  private async findChannel(input: NormalizedProfileInput): Promise<any | null> {
    const key = this.apiKey!;
    const username = input.username;
    // Prefer handle lookup, then legacy username, then search fallback.
    const attempts = [
      `${API}/channels?part=snippet,statistics&forHandle=@${encodeURIComponent(username)}&key=${key}`,
      `${API}/channels?part=snippet,statistics&forUsername=${encodeURIComponent(username)}&key=${key}`,
    ];
    for (const url of attempts) {
      const data = await this.getJson(url);
      if (data.items?.length) return data.items[0];
    }
    // Search as a last resort (costs quota but resolves display handles).
    const search = await this.getJson(
      `${API}/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(username)}&key=${key}`,
    );
    const channelId = search.items?.[0]?.snippet?.channelId ?? search.items?.[0]?.id?.channelId;
    if (!channelId) return null;
    const byId = await this.getJson(
      `${API}/channels?part=snippet,statistics&id=${channelId}&key=${key}`,
    );
    return byId.items?.[0] ?? null;
  }

  override async resolveProfile(
    input: NormalizedProfileInput,
  ): Promise<AdapterResult<ResolvedProfile>> {
    if (!this.apiConfigured) return this.manualFallback('NO_CREDENTIAL');
    try {
      const channel = await this.findChannel(input);
      if (!channel) return this.manualFallback('NOT_FOUND');
      const s = channel.statistics ?? {};
      const sn = channel.snippet ?? {};
      return {
        ok: true,
        source: 'OFFICIAL_API',
        data: {
          platform: 'YOUTUBE',
          username: input.username,
          profileUrl: input.profileUrl,
          displayName: sn.title ?? null,
          avatarUrl: sn.thumbnails?.high?.url ?? sn.thumbnails?.default?.url ?? null,
          bio: sn.description ?? null,
          followers: s.subscriberCount != null ? Number(s.subscriberCount) : null,
          following: null,
          postCount: s.videoCount != null ? Number(s.videoCount) : null,
          isVerified: null,
          platformUserId: channel.id ?? null,
          raw: channel,
        },
      };
    } catch (err: any) {
      if (err?.code === 403) return this.manualFallback('RATE_LIMITED');
      return this.manualFallback('PROVIDER_ERROR');
    }
  }

  override async syncProfile(account: {
    username: string;
    platformUserId?: string | null;
  }): Promise<AdapterResult<ProfileSyncResult>> {
    if (!this.apiConfigured) return this.manualFallback('NO_CREDENTIAL');
    try {
      const key = this.apiKey!;
      const url = account.platformUserId
        ? `${API}/channels?part=snippet,statistics&id=${account.platformUserId}&key=${key}`
        : `${API}/channels?part=snippet,statistics&forHandle=@${encodeURIComponent(account.username)}&key=${key}`;
      const data = await this.getJson(url);
      const channel = data.items?.[0];
      if (!channel) return this.manualFallback('NOT_FOUND');
      const s = channel.statistics ?? {};
      return {
        ok: true,
        source: 'OFFICIAL_API',
        data: {
          followers: s.subscriberCount != null ? Number(s.subscriberCount) : null,
          postCount: s.videoCount != null ? Number(s.videoCount) : null,
          avatarUrl: channel.snippet?.thumbnails?.high?.url ?? null,
          displayName: channel.snippet?.title ?? null,
          raw: channel,
        },
      };
    } catch (err: any) {
      if (err?.code === 403) return this.manualFallback('RATE_LIMITED');
      return this.manualFallback('PROVIDER_ERROR');
    }
  }

  override async syncContentMetrics(content: {
    externalId: string | null;
  }): Promise<AdapterResult<ContentMetricsResult>> {
    if (!this.apiConfigured) return this.manualFallback('NO_CREDENTIAL');
    if (!content.externalId) return this.manualFallback('INVALID_INPUT');
    try {
      const data = await this.getJson(
        `${API}/videos?part=statistics&id=${encodeURIComponent(content.externalId)}&key=${this.apiKey}`,
      );
      const v = data.items?.[0]?.statistics;
      if (!v) return this.manualFallback('NOT_FOUND');
      return {
        ok: true,
        source: 'OFFICIAL_API',
        data: {
          views: v.viewCount != null ? Number(v.viewCount) : null,
          likes: v.likeCount != null ? Number(v.likeCount) : null,
          comments: v.commentCount != null ? Number(v.commentCount) : null,
          favorites: v.favoriteCount != null ? Number(v.favoriteCount) : null,
          shares: null,
          raw: v,
        },
      };
    } catch (err: any) {
      if (err?.code === 403) return this.manualFallback('RATE_LIMITED');
      return this.manualFallback('PROVIDER_ERROR');
    }
  }

  override async checkContentAvailability(content: {
    externalId: string | null;
    originalUrl: string;
  }): Promise<AvailabilityResult> {
    if (this.apiConfigured && content.externalId) {
      try {
        const data = await this.getJson(
          `${API}/videos?part=status&id=${encodeURIComponent(content.externalId)}&key=${this.apiKey}`,
        );
        if (!data.items?.length) {
          return { status: 'REMOVED', checkedVia: 'OFFICIAL_API', httpStatus: 200 };
        }
        const status = data.items[0].status;
        if (status?.privacyStatus === 'private') {
          return { status: 'PRIVATE', checkedVia: 'OFFICIAL_API', httpStatus: 200 };
        }
        return { status: 'LIVE', checkedVia: 'OFFICIAL_API', httpStatus: 200 };
      } catch {
        // fall through to oEmbed
      }
    }
    // Public oEmbed endpoint returns 401/404 for gone/private videos.
    return this.oembedCheck(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(content.originalUrl)}`,
    );
  }
}
