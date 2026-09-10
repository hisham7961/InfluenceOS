import type { FeatureClass, FeatureStatus } from '../dto';
import type { UserRole } from '../enums';

/**
 * Feature Registry (addendum §12, §36, §37) — the single code-level source of
 * truth for what the platform can do. The Platform & API admin views, the
 * Mobile Readiness dashboard, GET /api/v1/platform/* and the generated
 * docs/FEATURE_MATRIX.md all derive from THIS list, so nothing goes stale.
 *
 * "Mobile Ready" is not a database fact — a feature is mobile-ready only when
 * its business logic is server-side, an API endpoint exists and is documented,
 * auth + permissions are enforced server-side, contracts are stable, media is
 * represented independently of the Web UI, and filtering/pagination are
 * server-side (§37). We set `mobileReady` accordingly, honestly.
 */

export interface FeatureEntry {
  key: string;
  name: string;
  description: string;
  module: string;
  classification: FeatureClass;
  apiStatus: FeatureStatus;
  webStatus: FeatureStatus;
  mobileReady: boolean;
  permissions: UserRole[];
  flag: string | null;
  minApiVersion: string;
  apiEndpoints: string[];
  deepLink: string | null;
}

const ALL: UserRole[] = ['ADMIN', 'STAFF'];
const ADMIN_ONLY: UserRole[] = ['ADMIN'];

export const FEATURES: FeatureEntry[] = [
  {
    key: 'auth',
    name: 'Authentication',
    description: 'Login, token refresh, current user, logout, device sessions.',
    module: 'Auth',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: [
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/refresh',
      'POST /api/v1/auth/logout',
      'POST /api/v1/auth/change-password',
      'GET /api/v1/auth/me',
      'PATCH /api/v1/auth/me/preferences',
      'GET /api/v1/auth/sessions',
    ],
    deepLink: null,
  },
  {
    key: 'brands',
    name: 'Brands & Brand Switching',
    description: 'Multi-brand workspaces, brand CRUD and brand-scoped views.',
    module: 'Brands',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: [
      'GET /api/v1/brands',
      'POST /api/v1/brands',
      'GET /api/v1/brands/:id',
      'PATCH /api/v1/brands/:id',
      'GET /api/v1/brands/:id/dashboard',
    ],
    deepLink: '/brands/:slug',
  },
  {
    key: 'influencers',
    name: 'Influencer Management',
    description: 'Directory, add-from-URL, 360 profile, social accounts, notes, tags, brand relationships.',
    module: 'Influencers',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: [
      'GET /api/v1/influencers',
      'POST /api/v1/influencers',
      'GET /api/v1/influencers/:id',
      'PATCH /api/v1/influencers/:id',
      'POST /api/v1/influencers/resolve',
      'GET /api/v1/influencers/:id/followers',
      'GET /api/v1/influencers/:id/audience-health',
    ],
    deepLink: '/influencers/:id',
  },
  {
    key: 'social_accounts',
    name: 'Social Accounts & Metrics',
    description: 'Per-network accounts, follower history snapshots, provenance.',
    module: 'Metrics',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: [
      'POST /api/v1/influencers/:id/social-accounts',
      'PATCH /api/v1/social-accounts/:id',
      'POST /api/v1/social-accounts/:id/sync',
    ],
    deepLink: null,
  },
  {
    key: 'campaigns',
    name: 'Campaign Management',
    description: 'Campaign CRUD, workspace, progress, influencers, statuses.',
    module: 'Campaigns',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: [
      'GET /api/v1/campaigns',
      'POST /api/v1/campaigns',
      'GET /api/v1/campaigns/:id',
      'PATCH /api/v1/campaigns/:id',
      'POST /api/v1/campaigns/:id/influencers',
    ],
    deepLink: '/campaigns/:id',
  },
  {
    key: 'deliverables',
    name: 'Deliverables',
    description: 'Per-influencer deliverables, statuses, requirements, publish links.',
    module: 'Deliverables',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: [
      'POST /api/v1/campaign-influencers/:id/deliverables',
      'PATCH /api/v1/deliverables/:id',
    ],
    deepLink: null,
  },
  {
    key: 'scripts',
    name: 'Scripts & References',
    description: 'Versioned scripts/briefs with read-only presentation mode.',
    module: 'Scripts',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: [
      'GET /api/v1/scripts/:id',
      'POST /api/v1/scripts',
      'POST /api/v1/scripts/:id/versions',
    ],
    deepLink: '/scripts/:id',
  },
  {
    key: 'content',
    name: 'Published Content & Player',
    description: 'URL parsing, media-independent content data + embed descriptors, monitoring status.',
    module: 'Content',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: 'liveContentEnabled',
    minApiVersion: 'v1',
    apiEndpoints: [
      'GET /api/v1/content/feed',
      'POST /api/v1/content',
      'GET /api/v1/content/:id',
      'PATCH /api/v1/content/:id',
      'GET /api/v1/content/:id/metrics',
    ],
    deepLink: '/content/:id',
  },
  {
    key: 'whats_new',
    name: "What's New",
    description: 'Cross-brand activity feed of newly published content and milestones.',
    module: 'Content',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: ['GET /api/v1/whats-new'],
    deepLink: null,
  },
  {
    key: 'calendar',
    name: 'Calendar',
    description: 'Campaign and deliverable calendar (month/week/agenda) driven by the API.',
    module: 'Calendar',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: ['GET /api/v1/calendar'],
    deepLink: null,
  },
  {
    key: 'costs',
    name: 'Cost Management',
    description: 'Budgets, agreed costs, gift values, expenses, payment status.',
    module: 'Costs',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: [
      'GET /api/v1/campaigns/:id/costs',
      'POST /api/v1/campaigns/:id/expenses',
      'PATCH /api/v1/expenses/:id',
    ],
    deepLink: null,
  },
  {
    key: 'reports',
    name: 'Reports & Analytics',
    description: 'Campaign/influencer/brand/content/spend reports + CSV export.',
    module: 'Reports',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: 'campaignReportsEnabled',
    minApiVersion: 'v1',
    apiEndpoints: ['GET /api/v1/reports'],
    deepLink: null,
  },
  {
    key: 'dashboard',
    name: 'Mission Control',
    description: 'Global + brand aggregated dashboards (pulse, attention, active campaigns).',
    module: 'Dashboard',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: ['GET /api/v1/dashboard/global', 'GET /api/v1/dashboard/attention'],
    deepLink: null,
  },
  {
    key: 'notifications',
    name: 'Notifications',
    description: 'In-app notifications with independent delivery channels (push-ready).',
    module: 'Notifications',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: [
      'GET /api/v1/notifications',
      'POST /api/v1/notifications/read',
    ],
    deepLink: null,
  },
  {
    key: 'activity',
    name: 'Activity Feed',
    description: 'Human-readable activity log across brands/campaigns/influencers.',
    module: 'Activity',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: ['GET /api/v1/activity'],
    deepLink: null,
  },
  {
    key: 'search',
    name: 'Global Search',
    description: 'Backend-driven search across influencers, campaigns, brands, content.',
    module: 'Search',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: ['GET /api/v1/search'],
    deepLink: null,
  },
  {
    key: 'files',
    name: 'Files & Attachments',
    description:
      'Two-phase signed uploads over private object storage (S3/MinIO presigned or local signed proxy) for campaigns, deliverables, scripts, influencers and notes. MIME allowlist + size limits enforced server-side; downloads via short-lived signed URLs.',
    module: 'Files',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: [
      'POST /api/v1/files',
      'POST /api/v1/files/complete',
      'GET /api/v1/files',
      'GET /api/v1/files/:id',
      'GET /api/v1/files/:id/blob',
      'DELETE /api/v1/files/:id',
    ],
    deepLink: null,
  },
  {
    key: 'integrations',
    name: 'Integration Capabilities',
    description: 'Public provider capability matrix + admin integration status.',
    module: 'Settings',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: ['GET /api/v1/integrations'],
    deepLink: null,
  },
  {
    key: 'client_config',
    name: 'Client Config & Feature Flags',
    description: 'Server-driven remote config, feature flags and mobile app version rules.',
    module: 'Settings',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: ['GET /api/v1/client-config', 'GET /api/v1/platform/features'],
    deepLink: null,
  },
  {
    key: 'storage_admin',
    name: 'Storage Administration',
    description: 'Admin view of object-storage configuration and usage: driver, private-by-default access model, upload limits, allowed types, object count and total size.',
    module: 'Settings',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ADMIN_ONLY,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: ['GET /api/v1/platform/storage'],
    deepLink: null,
  },
  {
    key: 'audit_admin',
    name: 'Audit Log',
    description: 'Admin-only, workspace-wide audit trail with server-side filters (actor, action, entity, brand/campaign, date range, free-text) and cursor pagination. Authorization enforced at the API layer (requireAdmin), not the UI.',
    module: 'Settings',
    classification: 'ADMIN_DESKTOP_ONLY',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: false,
    permissions: ADMIN_ONLY,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: ['GET /api/v1/platform/audit'],
    deepLink: null,
  },
  {
    key: 'provider_secrets',
    name: 'Provider Secrets',
    description: 'Server-only social provider credentials. Never exposed to any client.',
    module: 'Settings',
    classification: 'ADMIN_DESKTOP_ONLY',
    apiStatus: 'ADMIN_SERVER_ONLY',
    webStatus: 'READY',
    mobileReady: false,
    permissions: ADMIN_ONLY,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: ['PATCH /api/v1/integrations/:platform'],
    deepLink: null,
  },
  {
    key: 'user_admin',
    name: 'User Administration',
    description: 'Create/manage internal staff and admin users.',
    module: 'Settings',
    classification: 'ADMIN_DESKTOP_ONLY',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: false,
    permissions: ADMIN_ONLY,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: ['GET /api/v1/users', 'POST /api/v1/users'],
    deepLink: null,
  },
  {
    key: 'monitoring',
    name: 'Content Monitoring',
    description: 'Background availability monitoring, status changes, alerts.',
    module: 'Content',
    classification: 'SHARED',
    apiStatus: 'READY',
    webStatus: 'READY',
    mobileReady: true,
    permissions: ALL,
    flag: null,
    minApiVersion: 'v1',
    apiEndpoints: ['GET /api/v1/content/:id/monitoring'],
    deepLink: null,
  },
];

export const FEATURE_MODULES = Array.from(new Set(FEATURES.map((f) => f.module)));

export function getFeature(key: string): FeatureEntry | undefined {
  return FEATURES.find((f) => f.key === key);
}

export function computeCoverage() {
  const total = FEATURES.length;
  const apiReady = FEATURES.filter((f) => f.apiStatus === 'READY').length;
  const webReady = FEATURES.filter((f) => f.webStatus === 'READY').length;
  const mobileReady = FEATURES.filter((f) => f.mobileReady).length;
  const adminOnly = FEATURES.filter((f) => f.classification === 'ADMIN_DESKTOP_ONLY').length;
  const shared = FEATURES.filter((f) => f.classification === 'SHARED');
  const mobileReadinessPercent = shared.length
    ? Math.round((shared.filter((f) => f.mobileReady).length / shared.length) * 100)
    : 0;
  return { total, apiReady, webReady, mobileReady, adminOnly, mobileReadinessPercent };
}

export function listApiEndpoints(): { method: string; path: string; module: string }[] {
  const out: { method: string; path: string; module: string }[] = [];
  for (const f of FEATURES) {
    for (const ep of f.apiEndpoints) {
      const [method, path] = ep.split(' ');
      out.push({ method: method ?? 'GET', path: path ?? ep, module: f.module });
    }
  }
  return out;
}
