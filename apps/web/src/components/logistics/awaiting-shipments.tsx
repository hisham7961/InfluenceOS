'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PackageX, Send, TriangleAlert } from 'lucide-react';
import type { ShipmentAwaitingDTO } from '@influenceos/contracts';
import { appRoutes } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { errorMessage } from '@/lib/errors';
import { BidiText } from '@/components/common/bidi-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useApp } from '@/components/shell/app-context';

const SHOWN = 20;

/**
 * The red "waiting for a shipment" list: confirmed creators who get products
 * (a gift in the deal, a campaign that ships to every creator, or a
 * deliverable that needs the product) but have nothing asked of Logistics.
 * One click asks Logistics — the request copies the creator's address and
 * lands in the Logistics list. Hidden when nobody is waiting.
 *
 * Normally empty: requests are made automatically the moment a creator is
 * confirmed. What shows here was confirmed before that existed, or its
 * request was taken back and someone must decide again.
 */
export function AwaitingShipments({ campaignId }: { campaignId?: string }) {
  const t = useTranslations('logistics.awaiting');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const { can } = useApp();
  const mayAsk = can('CAMPAIGNS_MANAGE') || can('INFLUENCERS_MANAGE') || can('LOGISTICS_MANAGE');
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['shipments-awaiting', campaignId ?? 'all'],
    queryFn: () => api.shipments.awaiting({ ...(campaignId ? { campaignId } : {}), limit: SHOWN }),
    staleTime: 15_000,
  });

  const ask = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => api.campaignInfluencers.requestShipment(id))),
    onSuccess: (results) => {
      toast.success(t('requestedToast', { count: results.length }));
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const rows = query.data?.data ?? [];
  const total = query.data?.pagination?.total ?? rows.length;
  if (rows.length === 0) return null;

  const reason = (r: ShipmentAwaitingDTO) =>
    r.reason === 'DEAL'
      ? t('reason.DEAL', { deal: enumLabel(tEnums, 'dealType', r.dealType) })
      : t(`reason.${r.reason}`);

  return (
    <section
      aria-labelledby="awaiting-shipments-title"
      data-testid="awaiting-shipments"
      className="border-danger/40 bg-danger/5 rounded-2xl border p-4"
    >
      <div className="flex flex-wrap items-start gap-3">
        <PackageX className="text-danger mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="awaiting-shipments-title" className="text-danger text-sm font-semibold">
            {t('title', { count: total })}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">{t('description')}</p>
        </div>
        {mayAsk && rows.length > 1 ? (
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={ask.isPending}
            onClick={() => ask.mutate(rows.map((r) => r.campaignInfluencerId))}
          >
            <Send className="h-3.5 w-3.5" /> {t('askAll', { count: rows.length })}
          </Button>
        ) : null}
      </div>

      <ul className="divide-danger/15 mt-3 divide-y">
        {rows.map((r) => (
          <li key={r.campaignInfluencerId} className="flex flex-wrap items-center gap-3 py-2.5">
            <Avatar
              name={r.influencer.displayName}
              src={r.influencer.avatarUrl ?? undefined}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                <Link href={appRoutes.influencer(r.influencer.id)} className="hover:underline">
                  <BidiText>{r.influencer.displayName}</BidiText>
                </Link>
                {campaignId ? null : (
                  <>
                    <span className="text-muted-foreground"> · </span>
                    <Link
                      href={appRoutes.campaign(r.campaignId, 'shipments')}
                      className="text-muted-foreground hover:underline"
                    >
                      <BidiText>{r.campaignName}</BidiText>
                    </Link>
                  </>
                )}
              </p>
              <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                <span>{reason(r)}</span>
                {r.addressOnFile ? null : (
                  <span className="text-danger inline-flex items-center gap-1">
                    <TriangleAlert className="h-3 w-3" aria-hidden /> {t('noAddress')}
                  </span>
                )}
              </p>
            </div>
            {mayAsk ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={ask.isPending}
                onClick={() => ask.mutate([r.campaignInfluencerId])}
              >
                <Send className="h-3.5 w-3.5" /> {t('ask')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {total > rows.length ? (
        <p className="text-muted-foreground mt-2 text-xs">
          {t('more', { count: total - rows.length })}
        </p>
      ) : null}
    </section>
  );
}
