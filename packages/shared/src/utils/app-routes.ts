/**
 * Links into the web app that the server stores or returns: notification
 * targets, activity and search results, dashboard items, email buttons
 * (P2.6). Building them here keeps every link pointing at a page that
 * exists — `__tests__/app-routes.test.ts` checks each builder, and every
 * link literal left in the domain and worker, against the web app's pages.
 */

/** Tabs of the campaign workspace (`/campaigns/:id?tab=…`). */
export const CAMPAIGN_TABS = [
  'overview',
  'influencers',
  'deliverables',
  'submissions',
  'content',
  'scripts',
  'shipments',
  'sourcing',
  'costs',
  'performance',
  'sales',
  'operations',
  'discussion',
  'files',
  'activity',
] as const;
export type CampaignTab = (typeof CAMPAIGN_TABS)[number];

const q = (value: string) => encodeURIComponent(value);

export const appRoutes = {
  home: () => '/',
  campaign: (id: string, tab?: CampaignTab) => (tab ? `/campaigns/${q(id)}?tab=${tab}` : `/campaigns/${q(id)}`),
  campaignReport: (id: string) => `/campaigns/${q(id)}/report`,
  /** A brand's page; accepts the brand id or its slug. */
  brand: (idOrSlug: string) => `/brands/${q(idOrSlug)}`,
  brandUsageRights: (idOrSlug: string) => `/brands/${q(idOrSlug)}#usage-rights`,
  influencer: (id: string) => `/influencers/${q(id)}`,
  content: (id: string) => `/content/${q(id)}`,
  contentWall: () => '/content',
  inspiration: (itemId?: string) => (itemId ? `/inspiration?item=${q(itemId)}` : '/inspiration'),
  logistics: () => '/logistics',
  team: () => '/team',
  finance: () => '/finance',
  exec: () => '/exec',
  notifications: () => '/notifications',
  notificationSettings: () => '/settings/notifications',
  integrations: () => '/settings/integrations',
} as const;

/** The path part of an app link (no query or fragment). */
export function appRoutePath(link: string): string {
  return link.split(/[?#]/)[0] || '/';
}

/** An absolute link for use outside the app (emails). */
export function absoluteAppUrl(baseUrl: string, link: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${link.startsWith('/') ? link : `/${link}`}`;
}
