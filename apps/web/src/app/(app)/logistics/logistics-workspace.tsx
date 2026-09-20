'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, Package } from 'lucide-react';
import type { BrandSummaryDTO, LogisticsRequestDTO } from '@influenceos/contracts';
import {
  DELIVERABLE_TYPE_LABELS,
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONE,
} from '@influenceos/shared';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';

const ALL = 'all';
const isHttpUrl = (u: string | null): u is string => !!u && /^https?:\/\//i.test(u);

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong.';
}

export function LogisticsWorkspace({
  initial,
  brands,
}: {
  initial: { data: LogisticsRequestDTO[]; hasMore: boolean; nextCursor: string | null };
  brands: BrandSummaryDTO[];
}) {
  const [status, setStatus] = React.useState('');
  const [brandId, setBrandId] = React.useState('');
  const isDefault = !status && !brandId;

  const query = useInfiniteQuery({
    queryKey: ['logistics', status, brandId] as const,
    queryFn: ({ pageParam }) =>
      api.shipments.list({ cursor: pageParam, limit: 50, status: status || undefined, brandId: brandId || undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    initialData: isDefault ? () => ({ pages: [initial], pageParams: [undefined] }) : undefined,
    staleTime: 15_000,
  });

  const rows = React.useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <Select value={status || ALL} onValueChange={(v) => setStatus(v === ALL ? '' : v)}>
          <SelectTrigger className="h-10 w-full sm:w-48">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {SHIPMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {SHIPMENT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={brandId || ALL} onValueChange={(v) => setBrandId(v === ALL ? '' : v)}>
          <SelectTrigger className="h-10 w-full sm:w-48">
            <SelectValue placeholder="Brand" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All brands</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground sm:ms-auto">{rows.length} loaded</span>
      </div>

      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No shipments"
          description="Logistics requests created from any campaign's Shipments tab will appear here."
        />
      ) : (
        <Card className="overflow-hidden">
          <TableScroll>
            <Table className="min-w-[1000px]">
              <TableHead>
                <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                  <TableHeaderCell className="ps-5">Creator</TableHeaderCell>
                  <TableHeaderCell>Brand / Campaign</TableHeaderCell>
                  <TableHeaderCell>Deliverable</TableHeaderCell>
                  <TableHeaderCell>Products</TableHeaderCell>
                  <TableHeaderCell>Destination</TableHeaderCell>
                  <TableHeaderCell>Phone</TableHeaderCell>
                  <TableHeaderCell>Courier / Tracking</TableHeaderCell>
                  <TableHeaderCell align="end" className="pe-5">
                    Status
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((s) => {
                  const trackable = isHttpUrl(s.trackingUrl);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="ps-5">
                        {s.influencer ? (
                          <Link href={`/influencers/${s.influencer.id}`} className="flex items-center gap-2.5 hover:underline">
                            <Avatar name={s.influencer.displayName} src={s.influencer.avatarUrl} size="xs" />
                            <span className="truncate font-medium">{s.influencer.displayName}</span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-muted-foreground">
                        {s.brand ? (
                          <Link href={`/campaigns/${s.campaign?.id}`} className="hover:underline">
                            {s.brand.name} · {s.campaign?.name}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.deliverableType ? DELIVERABLE_TYPE_LABELS[s.deliverableType] : '—'}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground">
                        {s.items.length > 0
                          ? s.items.map((it) => `${it.productName}${it.quantity > 1 ? ` ×${it.quantity}` : ''}`).join(', ')
                          : '—'}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-muted-foreground">
                        {[s.city, s.country].filter(Boolean).join(', ') || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{s.phone ?? '—'}</TableCell>
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
                              {s.trackingNumber} <ExternalLink className="size-3.5" aria-hidden />
                            </a>
                          ) : (
                            s.trackingNumber
                          )
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell align="end" className="pe-5">
                        <StatusCell shipment={s} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScroll>
        </Card>
      )}

      {rows.length > 0 && query.hasNextPage ? (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StatusCell({ shipment }: { shipment: LogisticsRequestDTO }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (status: (typeof SHIPMENT_STATUSES)[number]) => api.shipments.updateStatus(shipment.id, { status }),
    onSuccess: () => {
      toast.success('Status updated.');
      queryClient.invalidateQueries();
      router.refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex items-center justify-end gap-2">
      <Badge tone={SHIPMENT_STATUS_TONE[shipment.status]}>{SHIPMENT_STATUS_LABELS[shipment.status]}</Badge>
      <Select value={shipment.status} onValueChange={(v) => update.mutate(v as (typeof SHIPMENT_STATUSES)[number])} disabled={update.isPending}>
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SHIPMENT_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {SHIPMENT_STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
