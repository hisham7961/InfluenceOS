/**
 * Content association status — a DERIVED UI label, never a stored column.
 * Computed the same way everywhere (API responses via the domain layer, and
 * the web app when it already has the raw ids in hand) so Web never
 * reimplements this rule. See docs/workflow/WORKFLOW_GAP_MATRIX.md.
 */
export type ContentAssociationStatus = 'FULLY_LINKED' | 'CAMPAIGN_LINKED' | 'INFLUENCER_LINKED' | 'UNASSIGNED';

export function contentAssociationStatus(row: {
  campaignId: string | null;
  influencerId: string | null;
}): ContentAssociationStatus {
  if (row.campaignId && row.influencerId) return 'FULLY_LINKED';
  if (row.campaignId) return 'CAMPAIGN_LINKED';
  if (row.influencerId) return 'INFLUENCER_LINKED';
  return 'UNASSIGNED';
}

export const CONTENT_ASSOCIATION_STATUS_LABELS: Record<ContentAssociationStatus, string> = {
  FULLY_LINKED: 'Fully linked',
  CAMPAIGN_LINKED: 'Campaign linked',
  INFLUENCER_LINKED: 'Influencer linked',
  UNASSIGNED: 'Unassigned',
};
