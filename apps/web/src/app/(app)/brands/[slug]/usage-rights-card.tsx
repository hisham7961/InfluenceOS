import { getLocale, getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/request';
import { ShieldCheck } from 'lucide-react';
import type { UsageRightDTO } from '@influenceos/contracts';
import { USAGE_RIGHT_EFFECTIVE_STATUS_TONE } from '@influenceos/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableScroll } from '@/components/ui/table';
import { BidiText } from '@/components/common/bidi-text';
import { shortDate } from '@/lib/format';
import { enumLabel } from '@/lib/enum-labels';
import { RecordUsageRightButton, UsageRightRowActions } from '@/components/usage-rights/usage-right-dialog';

/** Usage-rights ledger for a brand (W3-2 web surface): what each licence covers,
 *  where it applies, and how close it is to expiry — the legal-risk view that
 *  the worker also alerts on. Record a licence, edit or extend it, or revoke
 *  it from here. */
export async function UsageRightsCard({ brandId, rights }: { brandId: string; rights: UsageRightDTO[] }) {
  const t = await getTranslations('brands');
  const tc = await getTranslations('common');
  const tEnums = await getTranslations('enums');
  const locale = (await getLocale()) as Locale;
  const expiring = rights.filter((r) => r.effectiveStatus === 'EXPIRING_SOON').length;

  return (
    <Card id="usage-rights" className="mt-6 scroll-mt-20 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-muted-foreground" aria-hidden /> {t('usageRights.title')}
        </CardTitle>
        <div className="flex items-center gap-2">
          {expiring > 0 ? <Badge tone="warning">{t('usageRights.expiringSoon', { count: expiring })}</Badge> : null}
          <RecordUsageRightButton brandId={brandId} />
        </div>
      </CardHeader>
      {rights.length === 0 ? (
        <CardContent>
          <EmptyState icon={ShieldCheck} title={t('usageRights.emptyTitle')} description={t('usageRights.emptyDescription')} />
        </CardContent>
      ) : (
        <TableScroll>
          <Table className="min-w-[720px]">
            <TableHead>
              <TableRow className="border-b border-border bg-surface-muted/60 hover:bg-surface-muted/60">
                <TableHeaderCell className="ps-5">{t('usageRights.typeColumn')}</TableHeaderCell>
                <TableHeaderCell>{t('usageRights.scopeTerritoryColumn')}</TableHeaderCell>
                <TableHeaderCell>{t('usageRights.creatorColumn')}</TableHeaderCell>
                <TableHeaderCell>{t('usageRights.expiresColumn')}</TableHeaderCell>
                <TableHeaderCell align="end">{tc('status')}</TableHeaderCell>
                <TableHeaderCell align="end">
                  <span className="sr-only">{tc('actions')}</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rights.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="ps-5 font-medium">
                    {enumLabel(tEnums, 'usageRightType', r.usageType)}
                    {r.exclusive ? <Badge tone="accent" className="ms-2">{t('usageRights.exclusive')}</Badge> : null}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-muted-foreground">
                    <BidiText>{[r.scope, r.territory].filter(Boolean).join(' · ') || '—'}</BidiText>
                  </TableCell>
                  <TableCell>
                    <BidiText>{r.influencerName ?? '—'}</BidiText>
                  </TableCell>
                  <TableCell>
                    {r.expiresAt ? shortDate(r.expiresAt, locale) : t('usageRights.noExpiry')}
                    {r.daysUntilExpiry != null && r.daysUntilExpiry >= 0 ? (
                      <span className="ms-1 text-xs text-muted-foreground">
                        {t('usageRights.daysRemaining', { count: r.daysUntilExpiry })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell align="end">
                    <Badge tone={USAGE_RIGHT_EFFECTIVE_STATUS_TONE[r.effectiveStatus]}>
                      {enumLabel(tEnums, 'usageRightEffectiveStatus', r.effectiveStatus)}
                    </Badge>
                  </TableCell>
                  <TableCell align="end" className="w-12 pe-3">
                    <UsageRightRowActions right={r} />
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
