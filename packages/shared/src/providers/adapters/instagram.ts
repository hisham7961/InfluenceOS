import { BaseAdapter } from './base';
import type {
  AdapterResult,
  AvailabilityResult,
  ContentMetricsResult,
  NormalizedProfileInput,
  ProfileSyncResult,
  ResolvedProfile,
} from '../types';

/**
 * v21.0 reaches end of life on 2027-01-21, after which Meta silently downgrades
 * calls to the next usable version. v25.0 is what Meta's current Business
 * Discovery examples use and runs until 2028-07-29.
 */
const GRAPH = 'https://graph.facebook.com/v25.0';

/**
 * How many recent media to scan when matching a post. Business Discovery only
 * exposes a window of the target's newest media — an older post simply falls
 * out of reach, which is a platform ceiling, not a bug.
 */
const MEDIA_WINDOW = 50;

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
      const data = (await res.json()) as { business_discovery?: Record<string, unknown> };
      const bd = data.business_discovery as
        | {
            id?: string;
            username?: string;
            name?: string;
            biography?: string;
            followers_count?: number;
            follows_count?: number;
            media_count?: number;
            profile_picture_url?: string;
          }
        | undefined;
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

  override async syncProfile(account: {
    username: string;
    platformUserId?: string | null;
  }): Promise<AdapterResult<ProfileSyncResult>> {
    const res = await this.resolveProfile({
      platform: 'INSTAGRAM',
      username: account.username,
      profileUrl: `https://www.instagram.com/${account.username}/`,
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

  /**
   * Post-level likes & comments via the Business Discovery `media` edge.
   *
   * Deliberately partial, and the limits are platform ceilings we cannot code
   * around:
   *  - **Recent media only.** The edge returns the target's newest posts, so an
   *    older post yields NOT_FOUND and stays manual. There is no endpoint that
   *    resolves a post URL to a media id, and a media id returned here cannot be
   *    fetched directly ("performing a GET on any returned IG Media will fail
   *    due to insufficient permissions"), so everything must come back through
   *    field expansion on this one call.
   *  - **`like_count` is omitted when the owner hides like counts** — Meta drops
   *    the field under field expansion rather than erroring, so it reads as null.
   *  - **`view_count` covers Reels only** and mixes paid with organic reach.
   *  - **Professional accounts only**, same eligibility rule as resolveProfile.
   *
   * An Instagram post URL carries no username, so the caller supplies the owning
   * handle; without it there is nothing to run Business Discovery against.
   */
  override async syncContentMetrics(content: {
    externalId: string | null;
    originalUrl: string;
    ownerUsername?: string | null;
  }): Promise<AdapterResult<ContentMetricsResult>> {
    if (!this.apiConfigured) return this.manualFallback('REQUIRES_APP_AUTHORIZATION');
    const shortcode = content.externalId;
    const owner = content.ownerUsername;
    if (!shortcode || !owner) return this.manualFallback('INVALID_INPUT');
    try {
      const fields =
        'business_discovery.username(' +
        encodeURIComponent(owner) +
        `){media.limit(${MEDIA_WINDOW})` +
        '{id,permalink,like_count,comments_count,view_count,media_type,timestamp}}';
      const res = await this.fetchFn(
        `${GRAPH}/${this.igUserId}?fields=${fields}&access_token=${this.accessToken}`,
      );
      if (res.status === 400) return this.manualFallback('ACCOUNT_NOT_ELIGIBLE');
      if (res.status === 429) return this.manualFallback('RATE_LIMITED');
      if (!res.ok) return this.manualFallback('PROVIDER_ERROR');
      const data = (await res.json()) as {
        business_discovery?: { media?: { data?: unknown[] } };
      };
      const items = data.business_discovery?.media?.data;
      if (!Array.isArray(items)) return this.manualFallback('ACCOUNT_NOT_ELIGIBLE');
      const match = items.find(
        (m): m is {
          permalink?: string;
          like_count?: number;
          comments_count?: number;
          view_count?: number;
        } =>
          !!m &&
          typeof m === 'object' &&
          typeof (m as { permalink?: unknown }).permalink === 'string' &&
          this.permalinkMatches((m as { permalink: string }).permalink, shortcode),
      );
      // Outside the recent-media window (or not this account's post) — honest
      // miss, so the manual value already on record is left untouched.
      if (!match) return this.manualFallback('NOT_FOUND');
      return {
        ok: true,
        source: 'OFFICIAL_API',
        data: {
          // Reels only, and absent on other media types — null, never zero, so a
          // missing field is not recorded as a real count of zero.
          views: match.view_count ?? null,
          // Absent when the owner hides like counts; same reasoning as above.
          likes: match.like_count ?? null,
          comments: match.comments_count ?? null,
          shares: null,
          raw: match,
        },
      };
    } catch {
      return this.manualFallback('PROVIDER_ERROR');
    }
  }

  /**
   * Match `.../p/<shortcode>/` (or /reel/, /reels/, /tv/) against a known
   * shortcode. Compared segment-wise rather than by substring so one shortcode
   * can never match a longer one that merely starts with it.
   */
  private permalinkMatches(permalink: string, shortcode: string): boolean {
    let segments: string[];
    try {
      segments = new URL(permalink).pathname.split('/').filter(Boolean);
    } catch {
      return false;
    }
    const idx = segments.findIndex((s) => ['p', 'reel', 'reels', 'tv'].includes(s));
    return idx >= 0 && segments[idx + 1] === shortcode;
  }

  override async checkContentAvailability(content: {
    originalUrl: string;
  }): Promise<AvailabilityResult> {
    // The Instagram embed endpoint responds regardless of login for public
    // posts; a hard failure indicates removal. Best-effort only.
    return this.headCheck(content.originalUrl.replace(/\/?$/, '/embed'));
  }
}
