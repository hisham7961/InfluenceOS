import { BaseAdapter } from './base';
import type { AvailabilityResult } from '../types';

/**
 * TikTok adapter — profile & video statistics require creator OAuth (Login Kit
 * / Display API), which this product intentionally does not perform, so profile
 * and metric sync are manual. Public videos embed via the official TikTok embed
 * iframe (base class), and availability uses TikTok's public oEmbed endpoint,
 * which returns a non-200 for removed/private videos.
 */
export class TikTokAdapter extends BaseAdapter {
  readonly platform = 'TIKTOK' as const;

  get apiConfigured(): boolean {
    // Even with client credentials, creator authorization is still required
    // for the data we would want, so we never advertise it as active.
    return false;
  }

  override async checkContentAvailability(content: {
    originalUrl: string;
  }): Promise<AvailabilityResult> {
    return this.oembedCheck(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(content.originalUrl)}`,
    );
  }
}
