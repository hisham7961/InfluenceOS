import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/request';
import { AlertTriangle, Building2, CalendarClock, Clock, Coins, MapPin, PackageCheck, ShieldCheck, Truck, UserCog } from 'lucide-react';
import type { CreatorReliabilityDTO, CreatorSnapshotDTO } from '@influenceos/contracts';
import { countryName, SHIPMENT_STATUS_TONE } from '@influenceos/shared';
import { enumLabel } from '@/lib/enum-labels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LtrText } from '@/components/common/bidi-text';
import { formatCurrency, relativeTime } from '@/lib/format';

// Below this many completed deliverables, a colored on-time percentage would
// overstate confidence (e.g. one late delivery reading as a flat "0% on
// time" danger badge) — show the raw count instead.
const MIN_RELIABILITY_SAMPLE = 3;

function Stat({ icon: Icon, label, value, hint }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold text-foreground">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

/**
 * Creator 360's "10-second comprehension" snapshot (Operations Intelligence
 * pass, PART 25-28) — every figure is derived from real campaign/deliverable/
 * payment/shipment records (see creator360.service.ts); a metric with no
 * evidence shows "No data yet", never a guess.
 */
export async function CreatorSnapshot({
  influencerId,
  snapshot,
  reliability,
}: {
  influencerId: string;
  snapshot: CreatorSnapshotDTO;
  reliability: CreatorReliabilityDTO;
}) {
  const t = await getTranslations('influencers');
  const tc = await getTranslations('common');
  const te = await getTranslations('enums');
  const locale = (await getLocale()) as Locale;
  const onTimeRate = reliability.sampleSize > 0 ? Math.round((reliability.onTime / reliability.sampleSize) * 100) : null;
  const logisticsHref = `/logistics?influencerId=${influencerId}&hasOpenIssue=true`;

  return (
    <>
      {snapshot.openLogisticsIssues.length > 0 && (
        <Link
          href={logisticsHref}
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger transition-colors hover:bg-danger/10"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="font-medium">
            {snapshot.openLogisticsIssues.length === 1
              ? t('detail.snapshot.logisticsBannerSingle', {
                  issueType: enumLabel(te, 'logisticsIssueType', snapshot.openLogisticsIssues[0]!.type),
                })
              : t('detail.snapshot.logisticsBannerMultiple', { count: snapshot.openLogisticsIssues.length })}
          </span>
          <span className="ms-auto text-xs underline">{t('detail.snapshot.viewInLogistics')}</span>
        </Link>
      )}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('detail.snapshot.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={UserCog} label={t('detail.snapshot.owner')} value={snapshot.ownerName ?? tc('unassigned')} />
          <Stat
            icon={Building2}
            label={t('detail.snapshot.brandsWorkedWith')}
            value={snapshot.brandsWorkedWith}
            hint={t('detail.snapshot.collaborationsTotal', { count: snapshot.totalCollaborations })}
          />
          <Stat
            icon={CalendarClock}
            label={t('detail.snapshot.lastCollaboration')}
            value={snapshot.lastCollaborationAt ? relativeTime(snapshot.lastCollaborationAt, locale) : t('detail.snapshot.never')}
          />
          <Stat
            icon={Clock}
            label={t('detail.snapshot.lastContact')}
            value={snapshot.lastContactAt ? relativeTime(snapshot.lastContactAt, locale) : t('detail.snapshot.noRecord')}
          />
          <Stat
            icon={Coins}
            label={t('detail.snapshot.rateRange')}
            value={
              snapshot.rateRange ? (
                <LtrText>
                  {snapshot.rateRange.min === snapshot.rateRange.max
                    ? formatCurrency(snapshot.rateRange.min, snapshot.rateRange.currency)
                    : `${formatCurrency(snapshot.rateRange.min, snapshot.rateRange.currency)} – ${formatCurrency(snapshot.rateRange.max, snapshot.rateRange.currency)}`}
                </LtrText>
              ) : (
                t('detail.snapshot.noPaidDealsYet')
              )
            }
          />
          <Stat
            icon={Coins}
            label={t('detail.snapshot.outstandingPayment')}
            value={<LtrText>{formatCurrency(snapshot.outstandingPayment, snapshot.currency)}</LtrText>}
            hint={snapshot.outstandingPayment > 0 ? t('detail.snapshot.awaitingPayment') : undefined}
          />
          <Stat icon={PackageCheck} label={t('detail.snapshot.activeDeliverables')} value={snapshot.activeDeliverables} />
          <Stat icon={Truck} label={t('detail.snapshot.activeShipments')} value={snapshot.activeShipments} />
          {snapshot.mostRecentShipment && (
            <Stat
              icon={MapPin}
              label={t('detail.snapshot.currentShipment')}
              value={
                <Link href={logisticsHref.replace('&hasOpenIssue=true', '')} className="hover:underline">
                  <Badge tone={SHIPMENT_STATUS_TONE[snapshot.mostRecentShipment.status]}>
                    {enumLabel(te, 'shipmentStatus', snapshot.mostRecentShipment.status)}
                  </Badge>
                </Link>
              }
              hint={countryName(snapshot.mostRecentShipment.destinationCountryCode) ?? snapshot.mostRecentShipment.destinationCountryCode ?? undefined}
            />
          )}
        </CardContent>
        <CardContent className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-foreground">{t('detail.snapshot.deliveryReliability')}</span>
          </div>
          {reliability.sampleSize === 0 ? (
            <Badge tone="neutral">{t('detail.snapshot.noCompletedDeliverables')}</Badge>
          ) : reliability.sampleSize < MIN_RELIABILITY_SAMPLE ? (
            // Too few data points to color-code with confidence (a single
            // deliverable would otherwise render as a misleadingly definite
            // 100%/0% success/danger badge) — show the real count, neutral tone.
            <Badge tone="neutral">
              {t('detail.snapshot.limitedHistoryBadge', { onTime: reliability.onTime, sampleSize: reliability.sampleSize })}
            </Badge>
          ) : (
            <>
              <Badge tone={onTimeRate! >= 80 ? 'success' : onTimeRate! >= 50 ? 'warning' : 'danger'}>
                {t('detail.snapshot.onTimeBadge', { rate: onTimeRate, onTime: reliability.onTime, sampleSize: reliability.sampleSize })}
              </Badge>
              {reliability.late > 0 && reliability.averageDelayDays != null ? (
                <span className="text-xs text-muted-foreground">
                  {t('detail.snapshot.lateAveraging', { late: reliability.late, days: reliability.averageDelayDays })}
                </span>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
