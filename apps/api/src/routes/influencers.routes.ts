import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { cursorQuerySchema, pageNumberSchema, requests, z, type InfluencerExportRowDTO } from '@influenceos/contracts';
import { csvLocale, requireAuth, rowsToCsv, sendCsv, servicesFor } from '../http';

const idParam = z.object({ id: z.string() });

// Ordered columns for the influencer export (CSV header + JSON field intent).
// Kept next to the route so the header labels stay human-facing and stable.
const INFLUENCER_EXPORT_COLUMNS: { key: keyof InfluencerExportRowDTO & string; label: string }[] = [
  { key: 'id', label: 'ID' },
  { key: 'displayName', label: 'Display Name' },
  { key: 'fullName', label: 'Full Name' },
  { key: 'primaryUsername', label: 'Primary Username' },
  { key: 'primaryPlatform', label: 'Primary Platform' },
  { key: 'platforms', label: 'Platforms' },
  { key: 'totalFollowers', label: 'Total Followers' },
  { key: 'category', label: 'Category' },
  { key: 'country', label: 'Country' },
  { key: 'city', label: 'City' },
  { key: 'relationshipStatus', label: 'Relationship Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'audienceHealth', label: 'Audience Health' },
  { key: 'email', label: 'Email' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'managerName', label: 'Manager Name' },
  { key: 'managerContact', label: 'Manager Contact' },
  { key: 'preferredContact', label: 'Preferred Contact' },
  { key: 'languages', label: 'Languages' },
  { key: 'tags', label: 'Tags' },
  { key: 'ownerName', label: 'Owner' },
  { key: 'isActive', label: 'Active' },
  { key: 'createdAt', label: 'Created At' },
];

export async function influencerRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/influencers',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'List/filter influencers (directory)',
        querystring: requests.influencerFilterSchema,
      },
    },
    async (req) => servicesFor(req).influencers.list(req.query),
  );

  r.get(
    '/influencers/cursor',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'List/filter influencers with stable cursor pagination (W7-2)',
        querystring: requests.influencerCursorSchema,
      },
    },
    async (req) => servicesFor(req).influencers.listCursor(req.query),
  );

  r.get(
    '/influencers/country-summary',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Per-country creator counts for the directory country-first summary strip',
        querystring: requests.influencerCountrySummarySchema,
      },
    },
    async (req) => servicesFor(req).influencers.countrySummary(req.query),
  );

  r.get(
    '/influencers/export',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Export influencers and their information (CSV or JSON), honoring directory filters',
        querystring: requests.influencerExportSchema,
      },
    },
    async (req, reply) => {
      const rows = await servicesFor(req).influencers.exportRows(req.query);
      if (req.query.format === 'json') return rows;
      sendCsv(reply, 'influenceos-influencers.csv', rowsToCsv(INFLUENCER_EXPORT_COLUMNS, rows, await csvLocale(req, req.query.locale)));
      return reply;
    },
  );

  r.post(
    '/influencers',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Create an influencer', body: requests.influencerCreateSchema } },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).influencers.create(req.body);
    },
  );

  r.post(
    '/influencers/bulk/preview',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Dry-run preview of a bulk influencer-directory action (Operations Intelligence)',
        body: requests.bulkInfluencerRequestSchema,
      },
    },
    async (req) => servicesFor(req).bulkInfluencers.preview(req.body),
  );

  r.post(
    '/influencers/bulk/execute',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Apply a bulk influencer-directory action (admin only)',
        body: requests.bulkInfluencerRequestSchema,
      },
    },
    async (req) => servicesFor(req).bulkInfluencers.execute(req.body),
  );

  r.post(
    '/influencers/resolve',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Resolve a pasted profile URL/handle (official data or manual fallback)',
        body: requests.resolveProfileSchema,
      },
    },
    async (req) => servicesFor(req).providers.resolve(req.body.input, req.body.platform ?? null),
  );

  r.get(
    '/influencers/:id',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Influencer 360 profile', params: idParam } },
    async (req) => servicesFor(req).influencers.detail(req.params.id),
  );

  r.patch(
    '/influencers/:id',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Update an influencer', params: idParam, body: requests.influencerUpdateSchema } },
    async (req) => servicesFor(req).influencers.update(req.params.id, req.body),
  );

  r.delete(
    '/influencers/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Delete an influencer — hard delete if it has no campaign history, otherwise deactivate (isActive: false)',
        params: idParam,
      },
    },
    async (req) => servicesFor(req).influencers.remove(req.params.id),
  );

  r.post(
    '/influencers/:id/contact-log',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Log a message sent to the creator outside the app (e.g. from a WhatsApp template)',
        params: idParam,
        body: requests.influencerContactLogSchema,
      },
    },
    async (req, reply) => {
      await servicesFor(req).influencers.logContact(req.params.id, req.body);
      reply.status(204).send();
    },
  );

  r.post(
    '/influencers/:id/sync-avatar',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Re-resolve the profile photo from the linked primary social account',
        params: idParam,
      },
    },
    async (req) => servicesFor(req).influencers.syncAvatar(req.params.id),
  );

  r.get(
    '/influencers/:id/social-accounts',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Influencer social accounts', params: idParam } },
    async (req) => servicesFor(req).influencers.socialAccountsFor(req.params.id),
  );

  r.post(
    '/influencers/:id/social-accounts',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Add a social account to an influencer',
        params: idParam,
        body: requests.socialAccountCreateSchema.omit({ influencerId: true }),
      },
    },
    async (req, reply) => {
      reply.status(201);
      return servicesFor(req).socialAccounts.create({ ...req.body, influencerId: req.params.id });
    },
  );

  r.get(
    '/influencers/:id/followers',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Follower growth time series', params: idParam } },
    async (req) => servicesFor(req).influencers.followerSeries(req.params.id),
  );

  r.get(
    '/influencers/:id/audience-health',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Audience health signals', params: idParam } },
    async (req) => servicesFor(req).influencers.audienceFor(req.params.id),
  );

  r.get(
    '/influencers/:id/notes',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Internal notes for an influencer', params: idParam } },
    async (req) => servicesFor(req).notes.listForInfluencer(req.params.id),
  );

  // --- Creator 360 (Operations Intelligence pass) ---
  r.get(
    '/influencers/:id/snapshot',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Creator 360 snapshot', params: idParam } },
    async (req) => servicesFor(req).creator360.snapshot(req.params.id),
  );

  r.get(
    '/influencers/:id/reliability',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Deliverable-timeliness evidence', params: idParam } },
    async (req) => servicesFor(req).creator360.reliability(req.params.id),
  );

  r.get(
    '/influencers/:id/performance',
    {
      preHandler: [requireAuth],
      schema: {
        tags: ['Influencers'],
        summary: 'Results over time: median views/engagement (90 days and all time, per platform), on-time and rebook rates, paid and cost per view (finance access)',
        params: idParam,
      },
    },
    async (req) => servicesFor(req).creator360.performance(req.params.id),
  );

  r.get(
    '/influencers/:id/timeline',
    {
      preHandler: [requireAuth],
      schema: { tags: ['Influencers'], summary: 'Creator master timeline', params: idParam, querystring: cursorQuerySchema.merge(pageNumberSchema) },
    },
    async (req) => servicesFor(req).creator360.timeline(req.params.id, req.query),
  );

  // Every DeliverableSubmission (UGC draft/review) across every campaign this
  // creator has been in — the dedicated Creator 360 UGC tab (gap #11).
  r.get(
    '/influencers/:id/submissions',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Every submission across this creator\'s campaigns', params: idParam } },
    async (req) => servicesFor(req).creator360.submissions(req.params.id),
  );

  r.get(
    '/influencers/:id/brands',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Brand relationships for an influencer', params: idParam } },
    async (req) => servicesFor(req).brandInfluencers.listForInfluencer(req.params.id),
  );

  // --- Creator-OAuth connections (INT-3; inert until platform app review) ---
  const oauthParams = z.object({ id: z.string(), platform: z.string() });

  r.get(
    '/influencers/:id/creator-connections',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Creator-OAuth connections for an influencer', params: idParam } },
    async (req) => servicesFor(req).creatorOAuth.status(req.params.id),
  );

  r.post(
    '/influencers/:id/creator-connections/:platform/start',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Begin a creator-OAuth connection (returns the authorize URL)', params: oauthParams } },
    async (req) => servicesFor(req).creatorOAuth.start(req.params.id, req.params.platform.toUpperCase()),
  );

  r.delete(
    '/influencers/:id/creator-connections/:platform',
    { preHandler: [requireAuth], schema: { tags: ['Influencers'], summary: 'Disconnect a creator-OAuth connection', params: oauthParams } },
    async (req) => servicesFor(req).creatorOAuth.disconnect(req.params.id, req.params.platform.toUpperCase()),
  );
}
