import { Building2, CalendarClock, Clock, Coins, PackageCheck, ShieldCheck, Truck, UserCog } from 'lucide-react';
import type { CreatorReliabilityDTO, CreatorSnapshotDTO } from '@influenceos/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, relativeTime } from '@/lib/format';

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
export function CreatorSnapshot({ snapshot, reliability }: { snapshot: CreatorSnapshotDTO; reliability: CreatorReliabilityDTO }) {
  const onTimeRate = reliability.sampleSize > 0 ? Math.round((reliability.onTime / reliability.sampleSize) * 100) : null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Relationship Snapshot</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={UserCog} label="Owner" value={snapshot.ownerName ?? 'Unassigned'} />
        <Stat icon={Building2} label="Brands worked with" value={snapshot.brandsWorkedWith} hint={`${snapshot.totalCollaborations} collaborations total`} />
        <Stat icon={CalendarClock} label="Last collaboration" value={snapshot.lastCollaborationAt ? relativeTime(snapshot.lastCollaborationAt) : 'Never'} />
        <Stat icon={Clock} label="Last contact" value={snapshot.lastContactAt ? relativeTime(snapshot.lastContactAt) : 'No record'} />
        <Stat
          icon={Coins}
          label="Rate range"
          value={
            snapshot.rateRange
              ? snapshot.rateRange.min === snapshot.rateRange.max
                ? formatCurrency(snapshot.rateRange.min, snapshot.rateRange.currency)
                : `${formatCurrency(snapshot.rateRange.min, snapshot.rateRange.currency)} – ${formatCurrency(snapshot.rateRange.max, snapshot.rateRange.currency)}`
              : 'No paid deals yet'
          }
        />
        <Stat
          icon={Coins}
          label="Outstanding payment"
          value={formatCurrency(snapshot.outstandingPayment, snapshot.currency)}
          hint={snapshot.outstandingPayment > 0 ? 'Awaiting payment' : undefined}
        />
        <Stat icon={PackageCheck} label="Active deliverables" value={snapshot.activeDeliverables} />
        <Stat icon={Truck} label="Active shipments" value={snapshot.activeShipments} />
      </CardContent>
      <CardContent className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-foreground">Delivery reliability</span>
        </div>
        {reliability.sampleSize === 0 ? (
          <Badge tone="neutral">No completed deliverables with a due date yet</Badge>
        ) : (
          <>
            <Badge tone={onTimeRate! >= 80 ? 'success' : onTimeRate! >= 50 ? 'warning' : 'danger'}>
              {onTimeRate}% on time ({reliability.onTime}/{reliability.sampleSize})
            </Badge>
            {reliability.late > 0 && reliability.averageDelayDays != null ? (
              <span className="text-xs text-muted-foreground">
                {reliability.late} late, averaging {reliability.averageDelayDays} day{reliability.averageDelayDays === 1 ? '' : 's'} delayed
              </span>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
