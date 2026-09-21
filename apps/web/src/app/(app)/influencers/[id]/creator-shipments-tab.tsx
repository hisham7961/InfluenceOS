'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ExternalLink, Package } from 'lucide-react';
import { SHIPMENT_STATUS_TONE } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { LtrText } from '@/components/common/bidi-text';
import { relativeTime } from '@/lib/format';

// Tracking URLs are scheme-guarded on write (mirrors shipments-tab.tsx); still gate the anchor to http(s).
const isHttpUrl = (u: string | null): u is string => !!u && /^https?:\/\//i.test(u);

/**
 * Creator 360 Shipment History tab (gap #11) — every ProductShipment across
 * every campaign this creator has ever been on. Reuses the SAME cross-campaign
 * `shipments.list()` read the `/logistics` workspace uses (shipment.service.ts's
 * listAll/buildWhere), just narrowed with its existing `influencerId` filter —
 * that filter already applies the same brand/country scope as every other
 * shipment view, so nothing new needed to be added to shipment.service.ts.
 * "Open in Logistics" reuses the SAME deep-link convention the open-issue
 * banner on this page already uses (`/logistics?influencerId=…`) — there is no
 * `?shipmentId=` deep link into a single row's detail sheet anywhere in the
 * app today, so this is the real, already-working way to reach it.
 */
export function CreatorShipmentsTab({ influencerId }: { influencerId: string }) {
  const t = useTranslations('influencers');
  const te = useTranslations('enums');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['creator-shipments', influencerId],
    queryFn: () => api.shipments.list({ influencerId, limit: 50 }),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={Package}
        title={t('detail.shipments.errorTitle')}
        description={t('detail.shipments.errorDescription')}
      />
    );
  }

  const shipments = data?.data ?? [];

  if (shipments.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title={t('detail.shipments.emptyTitle')}
        description={t('detail.shipments.emptyDescription')}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <TableScroll>
          <Table className="min-w-[860px]">
            <TableHead>
              <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                <TableHeaderCell className="ps-5">{t('detail.shipments.table.brandCampaign')}</TableHeaderCell>
                <TableHeaderCell>{t('detail.shipments.table.products')}</TableHeaderCell>
                <TableHeaderCell>{t('detail.shipments.table.destination')}</TableHeaderCell>
                <TableHeaderCell>{t('detail.shipments.table.courierTracking')}</TableHeaderCell>
                <TableHeaderCell>{t('detail.shipments.table.shippedDelivered')}</TableHeaderCell>
                <TableHeaderCell align="end" className="pe-5">
                  {t('detail.shipments.table.status')}
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shipments.map((s) => {
                const trackable = isHttpUrl(s.trackingUrl);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="ps-5 max-w-[200px] truncate font-medium">
                      {s.brand ? `${s.brand.name} · ${s.campaign?.name ?? '—'}` : '—'}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {s.items.length > 0
                        ? s.items.map((it) => `${it.productName}${it.quantity > 1 ? ` ×${it.quantity}` : ''}`).join(', ')
                        : '—'}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-muted-foreground">
                      {[s.city, s.country].filter(Boolean).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.courier ? `${s.courier} · ` : ''}
                      {s.trackingNumber ? (
                        trackable ? (
                          <a
                            href={s.trackingUrl!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-brand hover:underline"
                          >
                            <LtrText>{s.trackingNumber}</LtrText> <ExternalLink className="size-3.5" aria-hidden />
                          </a>
                        ) : (
                          <LtrText>{s.trackingNumber}</LtrText>
                        )
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.shippedAt ? relativeTime(s.shippedAt) : '—'}
                      {s.deliveredAt ? ` → ${relativeTime(s.deliveredAt)}` : ''}
                    </TableCell>
                    <TableCell align="end" className="pe-5">
                      <Badge tone={SHIPMENT_STATUS_TONE[s.status]}>{enumLabel(te, 'shipmentStatus', s.status)}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
      </Card>
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href={`/logistics?influencerId=${influencerId}`}>{t('detail.shipments.openInLogistics')}</Link>
        </Button>
      </div>
    </div>
  );
}
