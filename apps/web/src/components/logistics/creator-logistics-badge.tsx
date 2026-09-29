'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Package, PackageCheck, PackageX, Send, Truck } from 'lucide-react';
import type { CreatorLogisticsState, ParticipationStatus, Tone } from '@influenceos/contracts';
import { appRoutes } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { errorMessage } from '@/lib/errors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useApp } from '@/components/shell/app-context';

const TONE: Record<CreatorLogisticsState, Tone> = {
  NOT_NEEDED: 'neutral',
  NEEDED: 'danger',
  REQUESTED: 'info',
  ADDRESS_MISSING: 'danger',
  PROBLEM: 'danger',
  ON_THE_WAY: 'info',
  DELIVERED: 'success',
};

const ICON = {
  NOT_NEEDED: Package,
  NEEDED: PackageX,
  REQUESTED: Package,
  ADDRESS_MISSING: PackageX,
  PROBLEM: PackageX,
  ON_THE_WAY: Truck,
  DELIVERED: PackageCheck,
} as const;

/**
 * Where a roster creator's products stand, in one badge (red when someone
 * must act), with "Ask Logistics" right next to it when nothing has been
 * asked yet. A confirmed creator who doesn't get products says so — and can
 * still be sent something ("Send products anyway").
 */
export function CreatorLogisticsBadge({
  campaignId,
  campaignInfluencerId,
  participationStatus,
  state,
}: {
  campaignId: string;
  campaignInfluencerId: string;
  participationStatus: ParticipationStatus;
  state: CreatorLogisticsState;
}) {
  const t = useTranslations('campaigns.workspace.influencers.logistics');
  const tCommon = useTranslations('common');
  const { can } = useApp();
  const mayAsk = can('CAMPAIGNS_MANAGE') || can('INFLUENCERS_MANAGE') || can('LOGISTICS_MANAGE');
  const committed = participationStatus === 'CONFIRMED' || participationStatus === 'IN_PROGRESS';
  const queryClient = useQueryClient();

  const ask = useMutation({
    mutationFn: () => api.campaignInfluencers.requestShipment(campaignInfluencerId),
    onSuccess: () => {
      toast.success(t('requestedToast'));
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  // A creator who isn't committed only shows a shipment that exists, or — when
  // invited — that products will follow once they confirm.
  if (
    !committed &&
    (state === 'NOT_NEEDED' || (state === 'NEEDED' && participationStatus !== 'INVITED'))
  ) {
    return null;
  }
  const label = state === 'NEEDED' && !committed ? t('shipsOnConfirm') : t(`state.${state}`);
  const tone: Tone = state === 'NEEDED' && !committed ? 'neutral' : TONE[state];
  const Icon = ICON[state];

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="creator-logistics">
      <Link href={appRoutes.campaign(campaignId, 'shipments')} title={t(`hint.${state}`)}>
        <Badge tone={tone} className="gap-1" data-state={state}>
          <Icon className="h-3 w-3" aria-hidden />
          {label}
        </Badge>
      </Link>
      {mayAsk && committed && (state === 'NEEDED' || state === 'NOT_NEEDED') ? (
        <Button
          type="button"
          size="sm"
          variant={state === 'NEEDED' ? 'danger' : 'ghost'}
          className="h-6 px-2 text-xs"
          disabled={ask.isPending}
          onClick={() => ask.mutate()}
        >
          <Send className="h-3 w-3" /> {state === 'NEEDED' ? t('ask') : t('sendAnyway')}
        </Button>
      ) : null}
    </span>
  );
}
