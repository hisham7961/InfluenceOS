/**
 * React Query keys in one place (P2.8), so a change can refresh exactly the
 * data it touched: `queryClient.invalidateQueries({ queryKey: qk.campaign.all(id) })`
 * refreshes everything about one campaign and nothing else.
 */
export const qk = {
  campaign: {
    all: (id: string) => ['campaign', id] as const,
    detail: (id: string) => ['campaign', id, 'detail'] as const,
    roster: (id: string) => ['campaign', id, 'roster'] as const,
    costs: (id: string) => ['campaign', id, 'costs'] as const,
    scripts: (id: string) => ['campaign', id, 'scripts'] as const,
    sales: (id: string) => ['campaign', id, 'sales'] as const,
    reportShares: (id: string) => ['campaign', id, 'report-shares'] as const,
    foundPosts: (id: string) => ['campaign', id, 'found-posts'] as const,
    licences: (id: string) => ['campaign', id, 'licences'] as const,
    /** A roster row's creator task links (keyed under the campaign so a campaign refresh covers them). */
    creatorLinks: (id: string, campaignInfluencerId: string) =>
      ['campaign', id, 'creator-links', campaignInfluencerId] as const,
  },
  influencer: {
    licences: (id: string) => ['influencer', id, 'licences'] as const,
    audience: (id: string) => ['influencer', id, 'audience'] as const,
  },
  complianceSettings: ['compliance-settings'] as const,
};
