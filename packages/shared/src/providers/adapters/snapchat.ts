import { BaseAdapter } from './base';

/**
 * Snapchat adapter — Snapchat exposes no public profile/content API for
 * third-party creator data, so everything is manual/URL-based. Content is not
 * embeddable (base class returns a link-only descriptor); availability is a
 * best-effort link check (base class `headCheck`).
 */
export class SnapchatAdapter extends BaseAdapter {
  readonly platform = 'SNAPCHAT' as const;

  get apiConfigured(): boolean {
    return false;
  }
}
