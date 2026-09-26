import { mergeCaptionRules, type CaptionRules } from '@influenceos/shared';

/**
 * What a deliverable's caption must carry (P3.5): the deliverable's own
 * hashtags and mentions plus the brand-approved script's, and the ad
 * disclosure whenever the creator is paid or gifted for it (every deal but
 * FREE) and posts it on their own account (not UGC, which the brand posts).
 * Unapproved script versions don't count — they can still change.
 */
export function disclosureRequiredFor(dealType: string, deliverableType?: string): boolean {
  return dealType !== 'FREE' && deliverableType !== 'UGC';
}

export const captionRulesSelect = {
  type: true,
  requiredHashtags: true,
  requiredMentions: true,
  campaignInfluencer: { select: { dealType: true } },
  scriptReference: {
    select: {
      approvedVersion: true,
      versions: { select: { version: true, hashtags: true, mentions: true } },
    },
  },
} as const;

export function captionRulesOf(d: {
  type: string;
  requiredHashtags: string[];
  requiredMentions: string[];
  campaignInfluencer: { dealType: string };
  scriptReference: {
    approvedVersion: number | null;
    versions: { version: number; hashtags: string[]; mentions: string[] }[];
  } | null;
}): CaptionRules {
  const approved = d.scriptReference?.approvedVersion
    ? (d.scriptReference.versions.find((v) => v.version === d.scriptReference!.approvedVersion) ??
      null)
    : null;
  return mergeCaptionRules(
    d,
    approved,
    disclosureRequiredFor(d.campaignInfluencer.dealType, d.type),
  );
}
