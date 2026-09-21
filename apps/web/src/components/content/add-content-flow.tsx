'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CampaignInfluencerDTO, DeliverableDTO, PublishedContentDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { Field, Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BidiText } from '@/components/common/bidi-text';

const NO_INFLUENCER = '__none__';
const NO_CAMPAIGN = '__none__';
const NO_DELIVERABLE = '__none__';

export interface AddContentFlowProps {
  /** Called after a successful create, with the created content. */
  onSuccess: (content: PublishedContentDTO) => void;
  onCancel?: () => void;
  /** Fixed context — when set, that field is not user-editable and is shown read-only. */
  lockInfluencerId?: string;
  lockInfluencerName?: string;
  lockCampaignId?: string;
  lockCampaignName?: string;
  lockDeliverableId?: string;
  lockDeliverableLabel?: string;
  /**
   * Campaign Workspace context: restrict the influencer selector to this
   * campaign's own roster (never a creator who isn't on it), and derive the
   * deliverable selector from the selected influencer's own deliverables on
   * this campaign. Prevents SCENARIO E's invalid combination by construction
   * instead of relying solely on the server rejecting it after the fact.
   */
  rosterScope?: CampaignInfluencerDTO[];
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/**
 * The ONE content-association create flow (per the "no duplicate forms"
 * policy). Reused, with different contextual defaults, by: Quick Add
 * (nothing preselected), the Influencer page (influencer locked), the
 * Campaign Live Content tab (campaign locked, roster-scoped selectors), and a
 * Deliverable row (deliverable locked — everything else is derived
 * server-side, no selectors shown at all). Business validation always stays
 * server-side (resolveContentAssociation) — this component only decides
 * which fields to show, never which combinations are valid.
 */
export function AddContentFlow({
  onSuccess,
  onCancel,
  lockInfluencerId,
  lockInfluencerName,
  lockCampaignId,
  lockCampaignName,
  lockDeliverableId,
  lockDeliverableLabel,
  rosterScope,
}: AddContentFlowProps) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const [url, setUrl] = React.useState('');
  const [influencerId, setInfluencerId] = React.useState(lockInfluencerId ?? '');
  const [campaignId, setCampaignId] = React.useState(lockCampaignId ?? '');
  const [deliverableId, setDeliverableId] = React.useState(lockDeliverableId ?? '');
  const [loading, setLoading] = React.useState(false);

  const deliverableLocked = Boolean(lockDeliverableId);
  const campaignLocked = Boolean(lockCampaignId);
  const influencerLocked = Boolean(lockInfluencerId);

  const needsGlobalInfluencers = !deliverableLocked && !influencerLocked && !rosterScope;
  const needsGlobalCampaigns = !deliverableLocked && !campaignLocked;

  const influencerOptions = useQuery({
    queryKey: ['influencers', 'options'],
    queryFn: () => api.influencers.list({ pageSize: 100 }),
    enabled: needsGlobalInfluencers,
  });
  const campaignOptions = useQuery({
    queryKey: ['campaigns', 'options'],
    queryFn: () => api.campaigns.list({ pageSize: 100 }),
    enabled: needsGlobalCampaigns,
  });

  // Deliverables for the selected influencer within the roster scope — only
  // ever shown scoped to one campaign, matching "filtered by campaign/influencer".
  const deliverableOptions: DeliverableDTO[] = React.useMemo(() => {
    if (!rosterScope || !influencerId) return [];
    const ci = rosterScope.find((c) => c.influencer.id === influencerId);
    return ci?.deliverables ?? [];
  }, [rosterScope, influencerId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    try {
      const content = await api.content.create({
        url: url.trim(),
        influencerId: deliverableLocked ? undefined : influencerId || undefined,
        campaignId: deliverableLocked ? undefined : campaignId || undefined,
        deliverableId: deliverableLocked ? lockDeliverableId : deliverableId || undefined,
      });
      toast.success(t('addFlow.successToast'));
      onSuccess(content);
    } catch (e) {
      toast.error(errMessage(e, tCommon('somethingWentWrong')));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('addFlow.contentUrlLabel')} hint={t('addFlow.contentUrlHint')}>
        <Input
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          autoFocus
        />
      </Field>

      {deliverableLocked ? (
        <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
          {t('addFlow.linkedToDeliverable', {
            label: lockDeliverableLabel ?? t('addFlow.thisDeliverable'),
          })}
        </div>
      ) : (
        <>
          {influencerLocked ? (
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
              {t('addFlow.influencerLabel')}{' '}
              <BidiText as="span" className="font-medium text-foreground">
                {lockInfluencerName}
              </BidiText>
            </div>
          ) : (
            <Field label={t('addFlow.influencerFieldLabel')} hint={t('addFlow.influencerFieldHint')}>
              <Select
                value={influencerId || NO_INFLUENCER}
                onValueChange={(v) => setInfluencerId(v === NO_INFLUENCER ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('addFlow.unknownInfluencer')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INFLUENCER}>{t('addFlow.unknownInfluencer')}</SelectItem>
                  {(rosterScope ?? []).map((ci) => (
                    <SelectItem key={ci.influencer.id} value={ci.influencer.id}>
                      <BidiText>{ci.influencer.displayName}</BidiText>
                    </SelectItem>
                  ))}
                  {(influencerOptions.data?.data ?? []).map((inf) => (
                    <SelectItem key={inf.id} value={inf.id}>
                      <BidiText>{inf.displayName}</BidiText>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {campaignLocked ? (
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
              {t('addFlow.campaignLabel')} <span className="font-medium text-foreground">{lockCampaignName}</span>
            </div>
          ) : (
            <Field label={t('addFlow.campaignFieldLabel')}>
              <Select value={campaignId || NO_CAMPAIGN} onValueChange={(v) => setCampaignId(v === NO_CAMPAIGN ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('addFlow.linkToCampaign')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CAMPAIGN}>{t('associations.noCampaignIndependent')}</SelectItem>
                  {(campaignOptions.data?.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.brand.name} · {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {rosterScope && influencerId ? (
            <Field label={t('addFlow.deliverableFieldLabel')} hint={t('addFlow.deliverableFieldHint')}>
              <Select
                value={deliverableId || NO_DELIVERABLE}
                onValueChange={(v) => setDeliverableId(v === NO_DELIVERABLE ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('addFlow.noDeliverable')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DELIVERABLE}>{t('addFlow.noDeliverable')}</SelectItem>
                  {deliverableOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {enumLabel(tEnums, 'deliverableType', d.type)} · {d.platform}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </>
      )}

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {tCommon('cancel')}
          </Button>
        ) : null}
        <Button type="submit" disabled={loading}>
          {loading ? t('addFlow.adding') : t('addFlow.addContent')}
        </Button>
      </div>
    </form>
  );
}
