import { slugify } from '@influenceos/shared';
import {
  requests,
  z,
  API_VERSION,
  FEATURES,
  FEATURE_MODULES,
  computeCoverage,
  listApiEndpoints,
  type ApiEndpointDTO,
  type ApiModuleDTO,
  type AppVersionRuleDTO,
  type ClientConfigDTO,
  type FeatureDTO,
  type FeatureFlagScope,
  type AuditEntryDTO,
  type AuditEntityType,
  type CursorPage,
  type HealthComponentDTO,
  type PlatformStatusDTO,
  type StorageStatusDTO,
} from '@influenceos/contracts';
import { ActivityType, Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { requireAdmin } from '../lib/authz';
import { getStorage } from '../lib/storage';
import { maxUploadBytes } from './attachment.service';
import { iso, logActivity } from '../lib/helpers';
import { makeProviderService } from './provider.service';

/**
 * Settings > Platform & API (addendum §12-17, §26, §33). Backs the admin
 * "what can the API/web/mobile actually do" views, the public client-config
 * endpoint mobile/web clients bootstrap from, and feature-flag administration.
 * The feature registry (@influenceos/contracts/registry/features) is the
 * single source of truth — this service only reads and reshapes it plus the
 * small set of DB-backed platform settings (ClientConfig, AppVersion,
 * FeatureFlag). Never returns provider secrets or credential config.
 */

type AppVersionUpdate = z.infer<typeof requests.appVersionUpdateSchema>;
type ClientConfigUpdate = z.infer<typeof requests.clientConfigUpdateSchema>;
type MobilePlatform = 'IOS' | 'ANDROID';

/** Admin-facing feature flag row shape (not a public DTO — surfaced only to admins). */
export interface PlatformFlagDTO {
  key: string;
  description: string | null;
  scope: FeatureFlagScope;
  enabled: boolean;
  brandId: string | null;
}

/** Admin-facing app version rule shape, keyed by platform. */
export interface AppVersionAdminDTO extends AppVersionRuleDTO {
  platform: MobilePlatform;
  updatedAt: string | null;
}

const DEFAULT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const DEFAULT_FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'video/mp4'];
const MOBILE_PLATFORMS: MobilePlatform[] = ['IOS', 'ANDROID'];

export function makePlatformService(ctx: DomainContext) {
  const { prisma } = ctx;

  /** Feature registry, verbatim (spec §12, §36). One code-level source of truth. */
  function features(): FeatureDTO[] {
    return FEATURES.map((f) => ({ ...f, permissions: [...f.permissions], apiEndpoints: [...f.apiEndpoints] }));
  }

  /** Per-module rollup of the feature registry, for the Platform & API admin screen. */
  function modules(): ApiModuleDTO[] {
    const allEndpoints = listApiEndpoints();
    return FEATURE_MODULES.map((moduleName) => {
      const moduleFeatures = FEATURES.filter((f) => f.module === moduleName);
      const sharedFeatures = moduleFeatures.filter((f) => f.classification === 'SHARED');
      return {
        key: slugify(moduleName),
        name: moduleName,
        apiReady: moduleFeatures.every(
          (f) => f.apiStatus === 'READY' || f.apiStatus === 'ADMIN_SERVER_ONLY',
        ),
        webIntegrated: moduleFeatures.every((f) => f.webStatus === 'READY'),
        mobileReady: sharedFeatures.every((f) => f.mobileReady),
        version: API_VERSION,
        endpointCount: allEndpoints.filter((e) => e.module === moduleName).length,
        docsPath: '/api/docs',
      };
    });
  }

  /** Live platform status: versions, DB health, mobile-readiness coverage. */
  async function status(): Promise<PlatformStatusDTO> {
    let dbStatus: HealthComponentDTO['status'] = 'ok';
    let dbDetail: string | undefined;
    try {
      await prisma.$queryRaw(Prisma.sql`SELECT 1`);
    } catch (err) {
      dbStatus = 'down';
      dbDetail = err instanceof Error ? err.message : 'Database check failed.';
    }

    const health: HealthComponentDTO[] = [
      dbDetail ? { name: 'Database', status: dbStatus, detail: dbDetail } : { name: 'Database', status: dbStatus },
      { name: 'Redis', status: 'unknown' },
      { name: 'Worker', status: 'unknown' },
      {
        name: 'Storage',
        status: (process.env.STORAGE_DRIVER ?? 'local') === 'local' || process.env.S3_INTERNAL_ENDPOINT || process.env.S3_ENDPOINT ? 'ok' : 'unknown',
      },
    ];

    const coverage = computeCoverage();

    return {
      apiVersion: API_VERSION,
      backendVersion: process.env.npm_package_version ?? '0.1.0',
      webVersion: process.env.npm_package_version ?? '0.1.0',
      environment: process.env.NODE_ENV ?? 'development',
      apiBaseUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
      health,
      mobileReadinessPercent: coverage.mobileReadinessPercent,
      coverage: {
        totalFeatures: coverage.total,
        apiReady: coverage.apiReady,
        webReady: coverage.webReady,
        mobileReady: coverage.mobileReady,
        adminOnly: coverage.adminOnly,
      },
    };
  }

  /** Object-storage configuration & usage (admin-only Settings → Storage). */
  async function storageStatus(): Promise<StorageStatusDTO> {
    requireAdmin(ctx);
    const driver = getStorage(process.env);
    const agg = await prisma.attachment.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } });
    return {
      driver: driver.name,
      privateByDefault: true,
      bucket: driver.name === 's3' ? process.env.S3_BUCKET ?? 'influenceos' : null,
      endpoint: driver.name === 's3' ? process.env.S3_INTERNAL_ENDPOINT ?? process.env.S3_ENDPOINT ?? null : null,
      maxUploadMb: Math.round(maxUploadBytes() / (1024 * 1024)),
      allowedMimeTypes: [
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/gif',
        'application/pdf',
        'video/mp4',
        'video/webm',
        'video/quicktime',
        'text/plain',
        'text/csv',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      objectCount: agg._count._all,
      totalBytes: agg._sum.sizeBytes ?? 0,
    };
  }

  /**
   * Admin audit log (finding #5). ADMIN-only at the API layer — the UI check is
   * NOT the security boundary. Backed by ActivityLog with real server-side
   * filtering (actor, action type, entity, brand/campaign, date range,
   * free-text) and cursor pagination.
   */
  async function auditLog(filter: z.infer<typeof requests.auditFilterSchema>): Promise<CursorPage<AuditEntryDTO>> {
    requireAdmin(ctx);

    const entityColumn: Record<AuditEntityType, keyof Prisma.ActivityLogWhereInput> = {
      brand: 'brandId',
      campaign: 'campaignId',
      influencer: 'influencerId',
      deliverable: 'deliverableId',
      content: 'publishedContentId',
    };

    const and: Prisma.ActivityLogWhereInput[] = [];
    if (filter.actorId) and.push({ actorId: filter.actorId });
    if (filter.type && (Object.values(ActivityType) as string[]).includes(filter.type)) {
      and.push({ type: filter.type as ActivityType });
    }
    if (filter.brandId) and.push({ brandId: filter.brandId });
    if (filter.campaignId) and.push({ campaignId: filter.campaignId });
    if (filter.entityType && filter.entityId) {
      and.push({ [entityColumn[filter.entityType]]: filter.entityId });
    }
    if (filter.from || filter.to) {
      and.push({ createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } });
    }
    if (filter.q) and.push({ message: { contains: filter.q, mode: 'insensitive' } });

    const rows = await prisma.activityLog.findMany({
      where: and.length ? { AND: and } : {},
      include: {
        actor: { select: { name: true } },
        brand: { select: { name: true } },
        campaign: { select: { name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;

    const data: AuditEntryDTO[] = page.map((r) => {
      // Derive the primary entity by specificity.
      let entityType: AuditEntityType | null = null;
      let entityId: string | null = null;
      let link: string | null = null;
      if (r.publishedContentId) {
        entityType = 'content';
        entityId = r.publishedContentId;
        link = '/content';
      } else if (r.deliverableId) {
        entityType = 'deliverable';
        entityId = r.deliverableId;
        link = r.campaignId ? `/campaigns/${r.campaignId}` : null;
      } else if (r.campaignId) {
        entityType = 'campaign';
        entityId = r.campaignId;
        link = `/campaigns/${r.campaignId}`;
      } else if (r.influencerId) {
        entityType = 'influencer';
        entityId = r.influencerId;
        link = `/influencers/${r.influencerId}`;
      } else if (r.brandId) {
        entityType = 'brand';
        entityId = r.brandId;
        link = null;
      }
      return {
        id: r.id,
        type: r.type,
        message: r.message,
        actorId: r.actorId,
        actorName: r.actor?.name ?? null,
        entityType,
        entityId,
        brandId: r.brandId,
        brandName: r.brand?.name ?? null,
        campaignId: r.campaignId,
        campaignName: r.campaign?.name ?? null,
        meta: (r.meta ?? null) as Record<string, unknown> | null,
        createdAt: r.createdAt.toISOString(),
        link,
      };
    });

    return { data, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null, hasMore };
  }

  /** Flattened endpoint list (from the feature registry) with derived auth level. */
  function endpoints(): ApiEndpointDTO[] {
    return listApiEndpoints().map(({ method, path, module }) => {
      const feature = FEATURES.find((f) => f.apiEndpoints.includes(`${method} ${path}`));

      let auth: ApiEndpointDTO['auth'] = 'user';
      if (feature?.classification === 'ADMIN_DESKTOP_ONLY' || feature?.apiStatus === 'ADMIN_SERVER_ONLY') {
        auth = 'admin';
      } else if (
        path.includes('/auth/login') ||
        path.includes('/auth/refresh') ||
        path.includes('/client-config')
      ) {
        auth = 'public';
      }

      return {
        method,
        path,
        module,
        summary: feature?.name ?? module,
        version: feature?.minApiVersion ?? API_VERSION,
        auth,
      };
    });
  }

  /** Get-or-create the singleton row (client-safe config, addendum §16). */
  async function ensureClientConfigRow() {
    const existing = await prisma.clientConfig.findFirst();
    if (existing) return existing;
    return prisma.clientConfig.create({ data: {} });
  }

  async function appVersionRule(platform: MobilePlatform): Promise<AppVersionRuleDTO> {
    const row = await prisma.appVersion.findUnique({ where: { platform } });
    return {
      recommendedVersion: row?.recommendedVersion ?? null,
      minimumVersion: row?.minimumVersion ?? null,
      storeUrl: row?.storeUrl ?? null,
      forceUpdate: row?.forceUpdate ?? false,
      maintenanceMessage: row?.maintenanceMessage ?? null,
    };
  }

  /** Public, client-safe remote config (addendum §16, §19). Never includes secrets. */
  async function clientConfig(): Promise<ClientConfigDTO> {
    const [config, iosRule, androidRule, flags] = await Promise.all([
      ensureClientConfigRow(),
      appVersionRule('IOS'),
      appVersionRule('ANDROID'),
      prisma.featureFlag.findMany({
        where: { brandId: null },
        select: { key: true, enabled: true },
      }),
    ]);

    const supportedProviders = makeProviderService(ctx)
      .capabilities()
      .map((cap) => ({
        platform: cap.platform,
        contentEmbed: cap.contentEmbed !== 'NO',
        profileSync: cap.apiConfigured,
        enabled: true,
      }));

    return {
      apiVersion: API_VERSION,
      environment: process.env.NODE_ENV ?? 'development',
      maintenanceMode: config.maintenanceMode,
      maintenanceMessage: config.maintenanceMessage,
      defaultLanguage: config.defaultLanguage,
      supportedLanguages: config.supportedLanguages,
      enabledFeatures: flags.filter((f) => f.enabled).map((f) => f.key),
      disabledFeatures: flags.filter((f) => !f.enabled).map((f) => f.key),
      upload: {
        maxUploadMb: config.maxUploadMb,
        acceptedImageTypes: DEFAULT_IMAGE_TYPES,
        acceptedFileTypes: DEFAULT_FILE_TYPES,
      },
      supportedProviders,
      app: { ios: iosRule, android: androidRule },
      supportInfo: config.supportInfo,
    };
  }

  /** Admin: all feature flags (platform + brand-scoped), for the flags admin table. */
  async function getFlags(): Promise<PlatformFlagDTO[]> {
    requireAdmin(ctx);
    const flags = await prisma.featureFlag.findMany({ orderBy: [{ key: 'asc' }, { scope: 'asc' }] });
    return flags.map((f) => ({
      key: f.key,
      description: f.description,
      scope: f.scope,
      enabled: f.enabled,
      brandId: f.brandId,
    }));
  }

  /** Admin: toggle a platform-wide feature flag (create it if it doesn't exist yet). */
  async function setFlag(key: string, enabled: boolean): Promise<PlatformFlagDTO> {
    const actor = requireAdmin(ctx);
    const existing = await prisma.featureFlag.findFirst({
      where: { key, scope: 'PLATFORM', brandId: null },
    });
    const flag = existing
      ? await prisma.featureFlag.update({ where: { id: existing.id }, data: { enabled } })
      : await prisma.featureFlag.create({
          data: { key, scope: 'PLATFORM', brandId: null, enabled },
        });

    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} ${enabled ? 'enabled' : 'disabled'} the "${key}" feature flag.`,
      meta: { key, scope: 'PLATFORM', enabled },
    });

    return {
      key: flag.key,
      description: flag.description,
      scope: flag.scope,
      enabled: flag.enabled,
      brandId: flag.brandId,
    };
  }

  function toAppVersionAdminDTO(
    platform: MobilePlatform,
    row: {
      recommendedVersion: string | null;
      minimumVersion: string | null;
      storeUrl: string | null;
      forceUpdate: boolean;
      maintenanceMessage: string | null;
      updatedAt: Date;
    } | null,
  ): AppVersionAdminDTO {
    return {
      platform,
      recommendedVersion: row?.recommendedVersion ?? null,
      minimumVersion: row?.minimumVersion ?? null,
      storeUrl: row?.storeUrl ?? null,
      forceUpdate: row?.forceUpdate ?? false,
      maintenanceMessage: row?.maintenanceMessage ?? null,
      updatedAt: row ? iso(row.updatedAt) : null,
    };
  }

  /** Admin: mobile app version rules for both platforms (defaults when unset). */
  async function getAppVersions(): Promise<AppVersionAdminDTO[]> {
    const rows = await prisma.appVersion.findMany({ where: { platform: { in: MOBILE_PLATFORMS } } });
    const byPlatform = new Map(rows.map((r) => [r.platform, r]));
    return MOBILE_PLATFORMS.map((platform) => toAppVersionAdminDTO(platform, byPlatform.get(platform) ?? null));
  }

  /** Admin: upsert the version/rollout rules for one mobile platform. */
  async function updateAppVersion(
    platform: MobilePlatform,
    input: AppVersionUpdate,
  ): Promise<AppVersionAdminDTO> {
    const actor = requireAdmin(ctx);
    const row = await prisma.appVersion.upsert({
      where: { platform },
      update: {
        recommendedVersion: input.recommendedVersion === undefined ? undefined : input.recommendedVersion,
        minimumVersion: input.minimumVersion === undefined ? undefined : input.minimumVersion,
        storeUrl: input.storeUrl === undefined ? undefined : input.storeUrl,
        forceUpdate: input.forceUpdate ?? undefined,
        maintenanceMessage:
          input.maintenanceMessage === undefined ? undefined : input.maintenanceMessage,
      },
      create: {
        platform,
        recommendedVersion: input.recommendedVersion ?? null,
        minimumVersion: input.minimumVersion ?? null,
        storeUrl: input.storeUrl ?? null,
        forceUpdate: input.forceUpdate ?? false,
        maintenanceMessage: input.maintenanceMessage ?? null,
      },
    });

    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} updated the ${platform} app version rules.`,
      meta: { platform },
    });

    return toAppVersionAdminDTO(platform, row);
  }

  /** Admin: update the client-config singleton (maintenance mode, upload limits, etc). */
  async function updateClientConfig(input: ClientConfigUpdate): Promise<ClientConfigDTO> {
    const actor = requireAdmin(ctx);
    const existing = await prisma.clientConfig.findFirst();

    if (existing) {
      await prisma.clientConfig.update({
        where: { id: existing.id },
        data: {
          maintenanceMode: input.maintenanceMode ?? undefined,
          maintenanceMessage:
            input.maintenanceMessage === undefined ? undefined : input.maintenanceMessage,
          defaultLanguage: input.defaultLanguage ?? undefined,
          supportedLanguages: input.supportedLanguages ?? undefined,
          maxUploadMb: input.maxUploadMb ?? undefined,
          supportInfo: input.supportInfo === undefined ? undefined : input.supportInfo,
        },
      });
    } else {
      await prisma.clientConfig.create({
        data: {
          maintenanceMode: input.maintenanceMode ?? false,
          maintenanceMessage: input.maintenanceMessage ?? null,
          defaultLanguage: input.defaultLanguage ?? 'en',
          supportedLanguages: input.supportedLanguages ?? ['en', 'ar'],
          maxUploadMb: input.maxUploadMb ?? 50,
          supportInfo: input.supportInfo ?? null,
        },
      });
    }

    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} updated the platform client configuration.`,
    });

    return clientConfig();
  }

  return {
    features,
    modules,
    status,
    storageStatus,
    auditLog,
    endpoints,
    clientConfig,
    getFlags,
    setFlag,
    getAppVersions,
    updateAppVersion,
    updateClientConfig,
  };
}

export type PlatformService = ReturnType<typeof makePlatformService>;
