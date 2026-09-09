import type { Platform } from './enums';

/**
 * Client-safe configuration (addendum §16, §19). Returned by
 * GET /api/v1/client-config. NEVER contains secrets.
 */

export interface AppVersionRuleDTO {
  recommendedVersion: string | null;
  minimumVersion: string | null;
  storeUrl: string | null;
  forceUpdate: boolean;
  maintenanceMessage: string | null;
}

export interface PublicProviderCapabilityDTO {
  platform: Platform;
  contentEmbed: boolean;
  profileSync: boolean;
  enabled: boolean;
}

export interface ClientConfigDTO {
  apiVersion: string;
  environment: string;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  defaultLanguage: string;
  supportedLanguages: string[];
  enabledFeatures: string[];
  disabledFeatures: string[];
  upload: {
    maxUploadMb: number;
    acceptedImageTypes: string[];
    acceptedFileTypes: string[];
  };
  supportedProviders: PublicProviderCapabilityDTO[];
  app: {
    ios: AppVersionRuleDTO;
    android: AppVersionRuleDTO;
  };
  supportInfo: string | null;
}
