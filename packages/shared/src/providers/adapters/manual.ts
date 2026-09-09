import type { Platform } from '../../constants/platforms';
import type { AdapterContext } from '../types';
import { BaseAdapter } from './base';

/**
 * Safe manual fallback adapter (spec §21). Used when a provider is disabled or
 * no specialized adapter is available. It keeps the pure URL/embed helpers but
 * reports every network operation as manual — it never fabricates data.
 */
export class ManualAdapterFallback extends BaseAdapter {
  readonly platform: Platform;

  constructor(platform: Platform, ctx: AdapterContext = { credentials: {} }) {
    super(ctx);
    this.platform = platform;
  }

  get apiConfigured(): boolean {
    return false;
  }
}
