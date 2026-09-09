import { PLATFORMS, type Platform } from '@influenceos/shared';
import { requests, z, type IntegrationCapabilityDTO, type IntegrationDTO } from '@influenceos/contracts';
import { Prisma } from '@influenceos/database';
import type { DomainContext } from '../context';
import { AppError } from '../errors';
import { requireAdmin } from '../lib/authz';
import { iso, logActivity } from '../lib/helpers';
import { makeProviderService } from './provider.service';

/**
 * Admin Integrations service (spec §42). Reads/writes the per-platform
 * IntegrationSetting row and layers live provider capability info (from
 * @influenceos/shared, via provider.service) on top. Config (credentials) is
 * stored but NEVER returned to callers — the DTO carries only status/flags.
 */

type IntegrationUpdateInput = z.infer<typeof requests.integrationUpdateSchema>;

const settingSelect = {
  platform: true,
  isEnabled: true,
  monitoringEnabled: true,
  lastTestAt: true,
  lastSuccessAt: true,
  lastError: true,
} as const;

type IntegrationSettingRow = {
  platform: Platform;
  isEnabled: boolean;
  monitoringEnabled: boolean;
  lastTestAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
};

export function makeIntegrationService(ctx: DomainContext) {
  const { prisma } = ctx;

  /** Read the IntegrationSetting row for a platform, creating the default row if missing. */
  async function ensureSetting(platform: Platform): Promise<IntegrationSettingRow> {
    return prisma.integrationSetting.upsert({
      where: { platform },
      update: {},
      create: {
        platform,
        status: 'NOT_CONFIGURED',
        isEnabled: true,
        monitoringEnabled: true,
      },
      select: settingSelect,
    });
  }

  function deriveStatus(
    setting: IntegrationSettingRow,
    capability: IntegrationCapabilityDTO,
  ): IntegrationDTO['status'] {
    if (!setting.isEnabled) return 'DISABLED';
    if (capability.apiConfigured) return 'ENABLED';
    if (setting.lastError) return 'ERROR';
    return 'NOT_CONFIGURED';
  }

  function toDTO(setting: IntegrationSettingRow, capability: IntegrationCapabilityDTO): IntegrationDTO {
    return {
      platform: setting.platform,
      status: deriveStatus(setting, capability),
      isEnabled: setting.isEnabled,
      monitoringEnabled: setting.monitoringEnabled,
      lastTestAt: iso(setting.lastTestAt),
      lastSuccessAt: iso(setting.lastSuccessAt),
      lastError: setting.lastError,
      capabilities: capability,
    };
  }

  function capabilityFor(platform: Platform): IntegrationCapabilityDTO {
    const capability = makeProviderService(ctx)
      .capabilities()
      .find((c) => c.platform === platform);
    if (!capability) throw AppError.notFound(`Integration capability for ${platform}`);
    return capability;
  }

  /** IntegrationDTO for all supported platforms (spec §42 Admin Integrations screen). */
  async function list(): Promise<IntegrationDTO[]> {
    const capabilities = makeProviderService(ctx).capabilities();
    const capByPlatform = new Map(capabilities.map((c) => [c.platform, c]));

    const settings = await Promise.all(PLATFORMS.map((platform) => ensureSetting(platform)));

    return settings.map((setting) => {
      const capability = capByPlatform.get(setting.platform);
      if (!capability) throw AppError.notFound(`Integration capability for ${setting.platform}`);
      return toDTO(setting, capability);
    });
  }

  /** Admin-only: toggle enablement/monitoring and (optionally) store new credential config. */
  async function update(platform: Platform, input: IntegrationUpdateInput): Promise<IntegrationDTO> {
    const actor = requireAdmin(ctx);
    if (!PLATFORMS.includes(platform)) throw AppError.notFound('Platform');

    const configJson: Prisma.InputJsonValue | undefined =
      input.config === undefined ? undefined : (input.config as Prisma.InputJsonValue);

    const setting = await prisma.integrationSetting.upsert({
      where: { platform },
      update: {
        isEnabled: input.isEnabled ?? undefined,
        monitoringEnabled: input.monitoringEnabled ?? undefined,
        config: configJson,
      },
      create: {
        platform,
        status: 'NOT_CONFIGURED',
        isEnabled: input.isEnabled ?? true,
        monitoringEnabled: input.monitoringEnabled ?? true,
        config: configJson,
      },
      select: settingSelect,
    });

    // Never log the actual credential payload — only that it changed.
    await logActivity(ctx, {
      type: 'GENERIC',
      message: `${actor.name} updated the ${platform} integration settings.`,
      meta: {
        platform,
        isEnabled: setting.isEnabled,
        monitoringEnabled: setting.monitoringEnabled,
        configUpdated: input.config !== undefined,
      },
    });

    return toDTO(setting, capabilityFor(platform));
  }

  /** Admin-only: run a live connectivity check against the provider adapter (never throws on failure). */
  async function test(platform: Platform): Promise<{ ok: boolean; message: string }> {
    requireAdmin(ctx);
    if (!PLATFORMS.includes(platform)) throw AppError.notFound('Platform');

    const capability = capabilityFor(platform);
    const now = new Date();
    const ok = capability.apiConfigured;
    const message = ok
      ? `${platform} integration is configured and reachable.`
      : 'No credential configured';

    await prisma.integrationSetting.upsert({
      where: { platform },
      update: {
        lastTestAt: now,
        lastSuccessAt: ok ? now : undefined,
        lastError: ok ? null : message,
      },
      create: {
        platform,
        status: 'NOT_CONFIGURED',
        isEnabled: true,
        monitoringEnabled: true,
        lastTestAt: now,
        lastSuccessAt: ok ? now : null,
        lastError: ok ? null : message,
      },
    });

    return { ok, message };
  }

  return { list, update, test };
}

export type IntegrationService = ReturnType<typeof makeIntegrationService>;
