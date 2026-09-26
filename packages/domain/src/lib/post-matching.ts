/**
 * Post discovery matching (P3.4): does a post found on a creator's account
 * look like work for one of their running campaigns, and for which
 * deliverable? Only what the caption and date say — never a guess:
 *
 *   code:SARA15      the creator's promo code for that campaign     (3)
 *   hashtag:#glow    a hashtag the deliverables ask for             (2 each)
 *   mention:@brand   a mention the deliverables ask for             (2 each)
 *   brand            the brand's name                               (1)
 *   disclosure       #ad / #إعلان / "paid partnership"              (1, only when
 *                    the creator has a single running campaign)
 *
 * A post needs at least one signal, and must go up between two days before
 * the campaign (or the creator joining it) starts and three days after it
 * ends. The campaign with the most points wins; within it, the open
 * deliverable on the post's platform whose own tags matched, else the one
 * due soonest.
 */

import { hasDisclosure } from '@influenceos/shared';

const DAY = 86_400_000;
const FINISHED = new Set(['PUBLISHED', 'VERIFIED', 'CANCELLED', 'MISSED']);

export interface MatchDeliverable {
  id: string;
  platform: string;
  status: string;
  dueDate: Date | null;
  requiredHashtags: string[];
  requiredMentions: string[];
}

export interface MatchCampaign {
  campaignId: string;
  campaignInfluencerId: string;
  brandName: string;
  startDate: Date | null;
  endDate: Date | null;
  /** When the creator was added to the campaign (the window's start when the campaign has no start date). */
  joinedAt: Date;
  /** Promo codes the creator has on this campaign. */
  codes: string[];
  deliverables: MatchDeliverable[];
}

export interface MatchPost {
  platform: string;
  caption: string | null;
  postedAt: Date | null;
}

export interface PostMatch {
  campaignId: string;
  campaignInfluencerId: string;
  deliverableId: string | null;
  signals: string[];
  score: number;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-token search: "#glow" matches "#glow!" but not "#glowup". */
function hasToken(text: string, token: string): boolean {
  if (!token) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(token)}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
}

const tag = (t: string, prefix: '#' | '@') => {
  const clean = t.trim().replace(/^[#@]+/, '');
  return clean ? `${prefix}${clean}` : '';
};

function inWindow(c: MatchCampaign, postedAt: Date | null, now: Date): boolean {
  if (!postedAt) return true;
  const from = (c.startDate ?? c.joinedAt).getTime() - 2 * DAY;
  const to = (c.endDate ?? now).getTime() + 3 * DAY;
  return postedAt.getTime() >= from && postedAt.getTime() <= to;
}

export function matchPost(
  post: MatchPost,
  campaigns: MatchCampaign[],
  now = new Date(),
): PostMatch | null {
  const text = post.caption ?? '';
  if (!text.trim()) return null;
  const live = campaigns.filter((c) => inWindow(c, post.postedAt, now));
  const disclosed = hasDisclosure(text);
  let best: PostMatch | null = null;

  for (const c of live) {
    const signals: string[] = [];
    let score = 0;
    for (const code of new Set(c.codes.map((x) => x.trim()).filter(Boolean))) {
      if (hasToken(text, code)) {
        signals.push(`code:${code.toUpperCase()}`);
        score += 3;
      }
    }
    const open = c.deliverables.filter((d) => !FINISHED.has(d.status));
    const hashtags = new Set(
      c.deliverables
        .flatMap((d) => d.requiredHashtags.map((h) => tag(h, '#').toLowerCase()))
        .filter(Boolean),
    );
    const mentions = new Set(
      c.deliverables
        .flatMap((d) => d.requiredMentions.map((m) => tag(m, '@').toLowerCase()))
        .filter(Boolean),
    );
    for (const h of hashtags) {
      if (hasToken(text, h)) {
        signals.push(`hashtag:${h}`);
        score += 2;
      }
    }
    for (const m of mentions) {
      if (hasToken(text, m)) {
        signals.push(`mention:${m}`);
        score += 2;
      }
    }
    if (c.brandName.trim().length >= 3 && hasToken(text, c.brandName.trim())) {
      signals.push('brand');
      score += 1;
    }
    if (disclosed && live.length === 1) {
      signals.push('disclosure');
      score += 1;
    }
    if (score === 0) continue;

    // The deliverable: same platform, still open; the one whose own tags
    // matched first, then the one due soonest.
    const candidates = open
      .filter((d) => d.platform === post.platform)
      .map((d) => {
        const own =
          d.requiredHashtags.filter((h) => hasToken(text, tag(h, '#'))).length +
          d.requiredMentions.filter((m) => hasToken(text, tag(m, '@'))).length;
        return { d, own };
      })
      .sort(
        (a, b) =>
          b.own - a.own ||
          (a.d.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) -
            (b.d.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER),
      );

    if (!best || score > best.score) {
      best = {
        campaignId: c.campaignId,
        campaignInfluencerId: c.campaignInfluencerId,
        deliverableId: candidates[0]?.d.id ?? null,
        signals,
        score,
      };
    }
  }
  return best;
}
