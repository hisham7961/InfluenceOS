'use client';

/**
 * Localizes one AttentionItemDTO's title/description/actionLabel from its
 * `kind` + `params` (Arabic Localization pass) — `dashboard.service.ts`
 * still computes English `title`/`description`/`actionLabel` for any
 * consumer that hasn't adopted `params` yet, but the web app always renders
 * through here so Mission Control's Needs Attention panel and the Campaign
 * Operations Board never show raw English regardless of locale.
 */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { AttentionItemDTO } from '@influenceos/contracts';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { useLocalizedFormat } from '@/lib/format';

// Shared t.rich() tag handlers: `<name>` isolates a DB name (creator/
// campaign/brand — may be Arabic, English or mixed), `<ltr>` isolates a
// formatted date so it never scrambles inside the RTL panel.
const RICH_TAGS = {
  name: (chunks: ReactNode) => <BidiText as="span">{chunks}</BidiText>,
  ltr: (chunks: ReactNode) => <LtrText>{chunks}</LtrText>,
};

export function useAttentionActionLabel(kind: AttentionItemDTO['kind']): string | null {
  const t = useTranslations('attention');
  try {
    return t(`action.${kind}`);
  } catch {
    return null;
  }
}

export function AttentionItemTitle({ item }: { item: AttentionItemDTO }) {
  const t = useTranslations('attention');
  const p = item.params;
  switch (item.kind) {
    case 'DELIVERABLE_OVERDUE':
      return (
        <>
          {t.rich('deliverableOverdue.title', {
            influencerName: String(p.influencerName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'CONTENT_REMOVED':
      return <>{t('contentRemoved.title')}</>;
    case 'CONTENT_UNAVAILABLE':
      return <>{t('contentUnavailable.title')}</>;
    case 'CAMPAIGN_ENDING':
      return (
        <>
          {t.rich('campaignEnding.title', {
            campaignName: String(p.campaignName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'SHIPMENT_FAILED':
      return (
        <>
          {t.rich('shipmentFailed.title', {
            influencerName: String(p.influencerName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'SHIPMENT_RETURNED':
      return (
        <>
          {t.rich('shipmentReturned.title', {
            influencerName: String(p.influencerName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'LOGISTICS_ADDRESS_ISSUE':
      return (
        <>
          {t.rich('logisticsAddressIssue.title', {
            influencerName: String(p.influencerName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'USAGE_RIGHT_EXPIRING':
      return (
        <>
          {t.rich('usageRightExpiring.title', {
            brandName: String(p.brandName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'UGC_AWAITING_REVIEW':
      return (
        <>
          {t.rich('ugcAwaitingReview.title', {
            influencerName: String(p.influencerName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'UNASSIGNED_CONTENT':
      return <>{t('unassignedContent.title', { count: Number(p.count ?? 0) })}</>;
    case 'CAMPAIGN_MISSING_OWNER':
      return <>{t('campaignMissingOwner.title', { count: Number(p.count ?? 0) })}</>;
    case 'DISCLOSURE_MISSING':
      return (
        <>
          {t.rich('disclosureMissing.title', {
            campaignName: String(p.campaignName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'CREATOR_LICENCE':
      return (
        <>
          {t.rich('creatorLicence.title', {
            campaignName: String(p.campaignName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    default:
      // Reserved kinds dashboard.service.ts never emits today (SYNC_FAILURE,
      // OVER_BUDGET, MISSING_LINK, CREATOR_MISSING_INFO, INTEGRITY_ISSUE) —
      // this English fallback should be unreachable in practice.
      return <>{item.title}</>;
  }
}

export function AttentionItemDescription({ item }: { item: AttentionItemDTO }) {
  const t = useTranslations('attention');
  const tEnums = useTranslations('enums');
  const { shortDate } = useLocalizedFormat();
  const p = item.params;
  switch (item.kind) {
    case 'DELIVERABLE_OVERDUE':
      return (
        <>
          {t.rich('deliverableOverdue.description', {
            type: enumLabel(tEnums, 'deliverableType', String(p.type ?? '')),
            campaignName: String(p.campaignName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'CONTENT_REMOVED':
      return (
        <>
          {Number(p.hasInfluencer) === 1
            ? t.rich('contentRemoved.descriptionWithInfluencer', {
                platform: String(p.platform ?? ''),
                influencerName: String(p.influencerName ?? ''),
                ...RICH_TAGS,
              })
            : t('contentRemoved.descriptionNoInfluencer', { platform: String(p.platform ?? '') })}
        </>
      );
    case 'CONTENT_UNAVAILABLE':
      return (
        <>
          {Number(p.hasInfluencer) === 1
            ? t.rich('contentUnavailable.descriptionWithInfluencer', {
                platform: String(p.platform ?? ''),
                influencerName: String(p.influencerName ?? ''),
                ...RICH_TAGS,
              })
            : t('contentUnavailable.descriptionNoInfluencer', {
                platform: String(p.platform ?? ''),
              })}
        </>
      );
    case 'CAMPAIGN_ENDING':
      return (
        <>
          {t.rich('campaignEnding.description', {
            endDate: shortDate(String(p.endDate ?? '')),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'SHIPMENT_FAILED':
      return (
        <>
          {t.rich('shipmentFailed.description', {
            campaignName: String(p.campaignName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'SHIPMENT_RETURNED':
      return (
        <>
          {t.rich('shipmentReturned.description', {
            campaignName: String(p.campaignName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'LOGISTICS_ADDRESS_ISSUE':
      return (
        <>
          {t.rich('logisticsAddressIssue.description', {
            issueType: enumLabel(tEnums, 'logisticsIssueType', String(p.issueType ?? '')),
            campaignName: String(p.campaignName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'USAGE_RIGHT_EXPIRING':
      return (
        <>
          {t.rich('usageRightExpiring.description', {
            usageType: enumLabel(tEnums, 'usageRightType', String(p.usageType ?? '')),
            expiresAt: shortDate(String(p.expiresAt ?? '')),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'UGC_AWAITING_REVIEW':
      return (
        <>
          {t.rich('ugcAwaitingReview.description', {
            campaignName: String(p.campaignName ?? ''),
            ...RICH_TAGS,
          })}
        </>
      );
    case 'UNASSIGNED_CONTENT':
      return <>{t('unassignedContent.description')}</>;
    case 'CAMPAIGN_MISSING_OWNER':
      return <>{t('campaignMissingOwner.description')}</>;
    case 'DISCLOSURE_MISSING':
      return <>{t('disclosureMissing.description', { count: Number(p.count ?? 0) })}</>;
    case 'CREATOR_LICENCE': {
      const missing = Number(p.missing ?? 0);
      const expiring = Number(p.expiring ?? 0);
      return (
        <>
          {[
            missing ? t('creatorLicence.missing', { count: missing }) : null,
            expiring ? t('creatorLicence.expiring', { count: expiring }) : null,
          ]
            .filter(Boolean)
            .join(' ')}
        </>
      );
    }
    default:
      return <>{item.description}</>;
  }
}
