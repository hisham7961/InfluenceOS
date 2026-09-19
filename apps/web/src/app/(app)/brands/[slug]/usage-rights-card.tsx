import { ShieldCheck } from 'lucide-react';
import type { UsageRightDTO } from '@influenceos/contracts';
import {
  USAGE_RIGHT_EFFECTIVE_STATUS_LABELS,
  USAGE_RIGHT_EFFECTIVE_STATUS_TONE,
  USAGE_RIGHT_TYPE_LABELS,
} from '@influenceos/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { shortDate } from '@/lib/format';

/** Usage-rights ledger for a brand (W3-2 web surface): what each licence covers,
 *  where it applies, and how close it is to expiry — the legal-risk view that
 *  the worker also alerts on. Read-only; server-rendered. */
export function UsageRightsCard({ rights }: { rights: UsageRightDTO[] }) {
  const expiring = rights.filter((r) => r.effectiveStatus === 'EXPIRING_SOON').length;

  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-muted-foreground" aria-hidden /> Usage rights
        </CardTitle>
        {expiring > 0 ? <Badge tone="warning">{expiring} expiring soon</Badge> : null}
      </CardHeader>
      {rights.length === 0 ? (
        <CardContent>
          <EmptyState icon={ShieldCheck} title="No usage rights recorded" description="Licences for this brand's content will appear here with their coverage and expiry." />
        </CardContent>
      ) : (
        <TableScroll>
          <Table className="min-w-[720px]">
            <TableHead>
              <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                <TableHeaderCell className="ps-5">Type</TableHeaderCell>
                <TableHeaderCell>Scope / territory</TableHeaderCell>
                <TableHeaderCell>Creator</TableHeaderCell>
                <TableHeaderCell>Expires</TableHeaderCell>
                <TableHeaderCell align="end">Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rights.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="ps-5 font-medium">
                    {USAGE_RIGHT_TYPE_LABELS[r.usageType]}
                    {r.exclusive ? <Badge tone="accent" className="ms-2">Exclusive</Badge> : null}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-muted-foreground">
                    {[r.scope, r.territory].filter(Boolean).join(' · ') || '—'}
                  </TableCell>
                  <TableCell>{r.influencerName ?? '—'}</TableCell>
                  <TableCell>
                    {r.expiresAt ? shortDate(r.expiresAt) : 'No expiry'}
                    {r.daysUntilExpiry != null && r.daysUntilExpiry >= 0 ? (
                      <span className="ms-1 text-xs text-muted-foreground">({r.daysUntilExpiry}d)</span>
                    ) : null}
                  </TableCell>
                  <TableCell align="end">
                    <Badge tone={USAGE_RIGHT_EFFECTIVE_STATUS_TONE[r.effectiveStatus]}>
                      {USAGE_RIGHT_EFFECTIVE_STATUS_LABELS[r.effectiveStatus]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}
    </Card>
  );
}
