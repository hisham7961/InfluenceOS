'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { contentAssociationStatus, type Tone } from '@influenceos/shared';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BidiText } from '@/components/common/bidi-text';

const NONE = '__none__';

const STATUS_TONE: Record<ReturnType<typeof contentAssociationStatus>, Tone> = {
  FULLY_LINKED: 'success',
  CAMPAIGN_LINKED: 'info',
  INFLUENCER_LINKED: 'info',
  UNASSIGNED: 'warning',
};

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/**
 * The "Content Association Resolution" surface — lets an authorized user
 * assign/change/remove the influencer and campaign on existing content
 * (including resolving previously-unassigned content), reusing the same
 * server-side resolveContentAssociation validation as create() — never a
 * second set of rules on the client. Deliverable linkage is shown read-only
 * here (set once, at creation, from the Deliverable's own "Add Published
 * Content" action — see docs/workflow/WORKFLOW_GAP_MATRIX.md).
 */
export function ContentAssociationPanel({ content }: { content: PublishedContentDTO }) {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const [editing, setEditing] = React.useState(false);
  const [influencerId, setInfluencerId] = React.useState(content.influencer?.id ?? '');
  const [campaignId, setCampaignId] = React.useState(content.campaign?.id ?? '');

  const influencerOptions = useQuery({
    queryKey: ['influencers', 'options'],
    queryFn: () => api.influencers.list({ pageSize: 100 }),
    enabled: editing,
  });
  const campaignOptions = useQuery({
    queryKey: ['campaigns', 'options'],
    queryFn: () => api.campaigns.list({ pageSize: 100 }),
    enabled: editing,
  });

  const status = contentAssociationStatus({
    campaignId: content.campaign?.id ?? null,
    influencerId: content.influencer?.id ?? null,
  });

  const save = useMutation({
    mutationFn: () =>
      api.content.update(content.id, {
        influencerId: influencerId || null,
        campaignId: campaignId || null,
      }),
    onSuccess: () => {
      toast.success(t('associations.updateSuccess'));
      qc.invalidateQueries();
      router.refresh();
      setEditing(false);
    },
    onError: (e) => toast.error(errMessage(e, tCommon('somethingWentWrong'))),
  });

  function startEditing() {
    setInfluencerId(content.influencer?.id ?? '');
    setCampaignId(content.campaign?.id ?? '');
    setEditing(true);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{t('associations.title')}</CardTitle>
          <Badge tone={STATUS_TONE[status]}>{enumLabel(tEnums, 'contentAssociationStatus', status)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!editing ? (
          <>
            <AssocRow
              label={t('associations.fields.influencer')}
              value={content.influencer?.displayName}
              href={content.influencer ? `/influencers/${content.influencer.id}` : undefined}
              bidi
            />
            <AssocRow
              label={t('associations.fields.campaign')}
              value={content.campaign?.name}
              href={content.campaign ? `/campaigns/${content.campaign.id}` : undefined}
            />
            <AssocRow
              label={t('associations.fields.brand')}
              value={content.brand?.name}
              href={content.brand ? `/brands/${content.brand.id}` : undefined}
            />
            <AssocRow
              label={t('associations.fields.deliverable')}
              value={content.deliverable ? enumLabel(tEnums, 'deliverableType', content.deliverable.type) : undefined}
            />
            <Button type="button" variant="outline" size="sm" onClick={startEditing}>
              {t('associations.edit')}
            </Button>
          </>
        ) : (
          <>
            <Field label={t('associations.fields.influencer')} hint={t('associations.influencerHint')}>
              <Select value={influencerId || NONE} onValueChange={(v) => setInfluencerId(v === NONE ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={enumLabel(tEnums, 'contentAssociationStatus', 'UNASSIGNED')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{enumLabel(tEnums, 'contentAssociationStatus', 'UNASSIGNED')}</SelectItem>
                  {(influencerOptions.data?.data ?? []).map((inf) => (
                    <SelectItem key={inf.id} value={inf.id}>
                      <BidiText>{inf.displayName}</BidiText>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('associations.fields.campaign')} hint={t('associations.campaignHint')}>
              <Select value={campaignId || NONE} onValueChange={(v) => setCampaignId(v === NONE ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('associations.noCampaign')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('associations.noCampaignIndependent')}</SelectItem>
                  {(campaignOptions.data?.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.brand.name} · {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <p className="text-xs text-muted-foreground">{t('associations.validationNote')}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? tCommon('saving') : tCommon('save')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AssocRow({
  label,
  value,
  href,
  bidi,
}: {
  label: string;
  value?: string;
  href?: string;
  /** Wrap the value in BidiText — for user/database display names that may mix Arabic and Latin script. */
  bidi?: boolean;
}) {
  const rendered = bidi && value ? <BidiText>{value}</BidiText> : value;
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {value && href ? (
        <Link href={href} className="font-medium text-brand hover:underline">
          {rendered}
        </Link>
      ) : (
        <span className="font-medium text-foreground">{rendered ?? '—'}</span>
      )}
    </div>
  );
}
