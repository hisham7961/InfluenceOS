'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Package } from 'lucide-react';
import type { CampaignInfluencerDTO } from '@influenceos/contracts';
import { SHIPMENT_STATUS_LABELS, SHIPMENT_STATUS_TONE } from '@influenceos/shared';

// Tracking URLs are scheme-guarded on write; still gate the anchor to http(s).
const isHttpUrl = (u: string | null): u is string => !!u && /^https?:\/\//i.test(u);
import { api } from '@/lib/api-browser';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';

/** Product-seeding shipments across a campaign roster (W3-5 web surface): who
 *  the gift went to, courier + tracking, and delivery status — "did it arrive?"
 *  answerable from inside the campaign. Read-only. */
export function ShipmentsTab({ campaignId, influencers }: { campaignId: string; influencers: CampaignInfluencerDTO[] }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-shipments', campaignId],
    queryFn: () => api.campaigns.shipments(campaignId),
  });

  const byCi = new Map(influencers.map((ci) => [ci.id, ci]));

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
    return <EmptyState icon={Package} title="Couldn't load shipments" description="Something went wrong fetching product shipments. Try again shortly." />;
  }

  const shipments = data ?? [];
  if (shipments.length === 0) {
    return <EmptyState icon={Package} title="No shipments yet" description="Product shipments for gifted creators will appear here with courier, tracking and delivery status." />;
  }

  return (
    <Card className="overflow-hidden">
      <TableScroll>
        <Table className="min-w-[760px]">
          <TableHead>
            <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
              <TableHeaderCell className="ps-5">Creator</TableHeaderCell>
              <TableHeaderCell>Recipient</TableHeaderCell>
              <TableHeaderCell>Destination</TableHeaderCell>
              <TableHeaderCell>Courier</TableHeaderCell>
              <TableHeaderCell>Tracking</TableHeaderCell>
              <TableHeaderCell align="end">Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shipments.map((s) => {
              const inf = byCi.get(s.campaignInfluencerId)?.influencer;
              const trackable = isHttpUrl(s.trackingUrl);
              return (
                <TableRow key={s.id}>
                  <TableCell className="ps-5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={inf?.displayName ?? 'Unknown'} src={inf?.avatarUrl ?? undefined} size="xs" />
                      <span className="truncate font-medium">{inf?.displayName ?? 'Unassigned'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.recipientName ?? '—'}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {[s.city, s.country].filter(Boolean).join(', ') || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.courier ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.trackingNumber ? (
                      trackable ? (
                        <a href={s.trackingUrl!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                          {s.trackingNumber} <ExternalLink className="size-3.5" aria-hidden />
                        </a>
                      ) : (
                        s.trackingNumber
                      )
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell align="end">
                    <Badge tone={SHIPMENT_STATUS_TONE[s.status]}>{SHIPMENT_STATUS_LABELS[s.status]}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableScroll>
    </Card>
  );
}
