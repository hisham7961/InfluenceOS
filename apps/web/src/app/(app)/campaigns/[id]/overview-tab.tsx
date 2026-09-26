'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { CampaignDetailDTO } from '@influenceos/contracts';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText } from '@/components/common/bidi-text';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress';
import { formatPercent, useLocalizedFormat } from '@/lib/format';

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function DetailRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-end text-sm font-medium text-foreground">{value || '—'}</span>
    </div>
  );
}

export function OverviewTab({ campaign }: { campaign: CampaignDetailDTO }) {
  const t = useTranslations('campaigns');
  const tEnums = useTranslations('enums');
  const { shortDate } = useLocalizedFormat();
  const p = campaign.progress;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('fields.description')}</CardTitle>
          </CardHeader>
          <CardContent>
            {campaign.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{campaign.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('workspace.overview.noDescription')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('newForm.creativeBriefLabel')}</CardTitle>
          </CardHeader>
          <CardContent>
            {campaign.brief ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{campaign.brief}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('workspace.overview.noBrief')}</p>
            )}
          </CardContent>
        </Card>

        {campaign.internalNotes ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('workspace.overview.internalNotesTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-foreground">{campaign.internalNotes}</p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('workspace.overview.progressSummaryTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('workspace.overview.deliverablesPublishedLabel')}</span>
                <span className="font-medium text-foreground">
                  {p.deliverablesPublished}/{p.deliverablesTotal}
                </span>
              </div>
              <ProgressBar value={p.deliverableCompletion} tone="brand" className="mt-1.5" />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('workspace.overview.influencersCompletedLabel')}</span>
                <span className="font-medium text-foreground">
                  {p.influencersCompleted}/{p.influencersTotal}
                </span>
              </div>
              <ProgressBar
                value={p.influencersTotal > 0 ? (p.influencersCompleted / p.influencersTotal) * 100 : 0}
                tone="success"
                className="mt-1.5"
              />
            </div>
            {p.timeElapsedPercent != null ? (
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('workspace.overview.timeElapsedLabel')}</span>
                  <span className="font-medium text-foreground">{formatPercent(p.timeElapsedPercent, 0)}</span>
                </div>
                <ProgressBar value={p.timeElapsedPercent} tone="warning" className="mt-1.5" />
              </div>
            ) : null}
            {p.plannedBudget != null ? (
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('workspace.overview.budgetUsedLabel')}</span>
                  <span className="font-medium text-foreground">{formatPercent(p.budgetUsedPercent, 0)}</span>
                </div>
                <ProgressBar
                  value={p.budgetUsedPercent ?? 0}
                  tone={(p.budgetUsedPercent ?? 0) > 100 ? 'danger' : 'primary'}
                  className="mt-1.5"
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('workspace.overview.detailsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DetailRow
              label={t('fields.objective')}
              value={campaign.objective ? enumLabel(tEnums, 'campaignObjective', campaign.objective) : null}
            />
            <DetailRow label={t('fields.targetMarket')} value={campaign.targetMarket} />
            <DetailRow
              label={t('fields.owner')}
              value={campaign.owner?.name ? <BidiText>{campaign.owner.name}</BidiText> : null}
            />
            <DetailRow label={t('fields.currency')} value={campaign.currency} />
            <DetailRow label={t('fields.created')} value={shortDate(campaign.createdAt)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
