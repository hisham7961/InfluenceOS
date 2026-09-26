'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { EntityCombobox } from '@/components/common/entity-combobox';
import { BidiText } from '@/components/common/bidi-text';

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
export function ContentAssociationPanel({
  content,
  startEditing: startInEdit = false,
  onSaved,
  bare = false,
}: {
  content: PublishedContentDTO;
  /** Open straight on the pickers (the viewer's "Link" action). */
  startEditing?: boolean;
  onSaved?: () => void;
  /** No card around it — for use inside a dialog. */
  bare?: boolean;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const [editing, setEditing] = React.useState(startInEdit);
  const [influencerId, setInfluencerId] = React.useState(content.influencer?.id ?? '');
  const [campaignId, setCampaignId] = React.useState(content.campaign?.id ?? '');

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
      onSaved?.();
    },
    onError: (e) => toast.error(errMessage(e, tCommon('somethingWentWrong'))),
  });

  function startEditing() {
    setInfluencerId(content.influencer?.id ?? '');
    setCampaignId(content.campaign?.id ?? '');
    setEditing(true);
  }

  const body = (
    <div className="space-y-4">
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
            href={content.brand ? `/brands/${content.brand.slug}` : undefined}
          />
          <AssocRow
            label={t('associations.fields.deliverable')}
            value={
              content.deliverable
                ? enumLabel(tEnums, 'deliverableType', content.deliverable.type)
                : undefined
            }
          />
          <Button type="button" variant="outline" size="sm" onClick={startEditing}>
            {t('associations.edit')}
          </Button>
        </>
      ) : (
        <>
          <Field
            label={t('associations.fields.influencer')}
            hint={t('associations.influencerHint')}
          >
            <EntityCombobox
              kind="influencer"
              value={influencerId}
              valueLabel={
                influencerId === content.influencer?.id ? content.influencer.displayName : undefined
              }
              onChange={(id) => setInfluencerId(id)}
              placeholder={enumLabel(tEnums, 'contentAssociationStatus', 'UNASSIGNED')}
              noneLabel={enumLabel(tEnums, 'contentAssociationStatus', 'UNASSIGNED')}
              aria-label={t('associations.fields.influencer')}
            />
          </Field>
          <Field label={t('associations.fields.campaign')} hint={t('associations.campaignHint')}>
            <EntityCombobox
              kind="campaign"
              value={campaignId}
              valueLabel={campaignId === content.campaign?.id ? content.campaign.name : undefined}
              onChange={(id) => setCampaignId(id)}
              placeholder={t('associations.noCampaign')}
              noneLabel={t('associations.noCampaignIndependent')}
              aria-label={t('associations.fields.campaign')}
            />
          </Field>
          <p className="text-muted-foreground text-xs">{t('associations.validationNote')}</p>
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
    </div>
  );
  if (bare) return body;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{t('associations.title')}</CardTitle>
          <Badge tone={STATUS_TONE[status]}>
            {enumLabel(tEnums, 'contentAssociationStatus', status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>{body}</CardContent>
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
        <Link href={href} className="text-brand font-medium hover:underline">
          {rendered}
        </Link>
      ) : (
        <span className="text-foreground font-medium">{rendered ?? '—'}</span>
      )}
    </div>
  );
}
