import type { CampaignTab } from '@influenceos/shared';

/**
 * The campaign workspace's six areas (P2.8) and the views inside each. Links
 * keep using the view (`?tab=deliverables`), so every existing deep link
 * still lands on the right place; the area is worked out from it.
 */
export const WORKSPACE_GROUPS = [
  { key: 'overview', views: ['overview', 'performance'] },
  { key: 'roster', views: ['influencers', 'operations', 'sourcing'] },
  { key: 'content', views: ['content', 'deliverables'] },
  { key: 'approvals', views: ['submissions', 'scripts'] },
  { key: 'logistics', views: ['shipments', 'costs'] },
  { key: 'collaboration', views: ['discussion', 'activity', 'files'] },
] as const satisfies readonly { key: string; views: readonly CampaignTab[] }[];

export type WorkspaceGroup = (typeof WORKSPACE_GROUPS)[number]['key'];
export type WorkspaceView = (typeof WORKSPACE_GROUPS)[number]['views'][number];

export function groupOf(view: WorkspaceView): WorkspaceGroup {
  return WORKSPACE_GROUPS.find((g) => (g.views as readonly string[]).includes(view))!.key;
}
