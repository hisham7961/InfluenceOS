'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CircleAlert, Fingerprint, GitBranch, Info, ShieldQuestion } from 'lucide-react';
import type { BrandSummaryDTO, DataQualityFindingDTO, DataQualityReportDTO, DuplicateCandidateDTO, IntegrityFindingDTO, Tone } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { relativeTime } from '@/lib/format';
import { BidiText, LtrText } from '@/components/common/bidi-text';

const ALL = '__all__';

const SEVERITY_TONE: Record<DataQualityFindingDTO['severity'], Tone> = {
  critical: 'danger',
  needsAttention: 'warning',
  incomplete: 'info',
  informational: 'neutral',
};

const CONFIDENCE_TONE: Record<DuplicateCandidateDTO['confidence'], Tone> = {
  exact: 'danger',
  strongPossible: 'warning',
  possible: 'neutral',
};

const INTEGRITY_SEVERITY_TONE: Record<IntegrityFindingDTO['severity'], Tone> = {
  error: 'danger',
  warning: 'warning',
};

/** Social-platform / app names are proper nouns (never translated, per the
 * localization glossary) — only the non-proper-noun reason fields (email,
 * mobile, name) are looked up in the translation catalog. */
const PROPER_NOUN_REASON: Partial<Record<DuplicateCandidateDTO['reasons'][number]['field'], string>> = {
  instagramUsername: 'Instagram',
  tiktokUsername: 'TikTok',
  youtubeUsername: 'YouTube',
  snapchatUsername: 'Snapchat',
  xUsername: 'X',
  whatsapp: 'WhatsApp',
};

/** A next-intl translator (from useTranslations('dataQuality')). */
type DataQualityTranslator = (key: string, values?: Record<string, string | number>) => string;

function reasonFieldLabel(field: DuplicateCandidateDTO['reasons'][number]['field'], t: DataQualityTranslator): string {
  const properNoun = PROPER_NOUN_REASON[field];
  if (properNoun) return properNoun;
  return t(`duplicates.reasonField.${field as 'email' | 'mobile' | 'name'}`);
}

function FindingRow({ finding }: { finding: DataQualityFindingDTO }) {
  const t = useTranslations('dataQuality');
  return (
    <Link
      href={finding.link}
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-surface-muted"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Badge tone={SEVERITY_TONE[finding.severity]}>{t(`severity.${finding.severity}`)}</Badge>
        <span className="truncate text-foreground">{finding.title}</span>
        {finding.fixLabel ? (
          <Badge tone="accent" className="shrink-0">
            {finding.fixLabel}
          </Badge>
        ) : null}
      </div>
      <span className={finding.count > 0 ? 'font-semibold tabular-nums text-foreground' : 'tabular-nums text-muted-foreground'}>
        {finding.count}
      </span>
    </Link>
  );
}

function DuplicateRow({ candidate }: { candidate: DuplicateCandidateDTO }) {
  const t = useTranslations('dataQuality');
  return (
    <Link
      href={`/influencers/${candidate.influencerId}`}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-surface-muted"
    >
      <Avatar name={candidate.displayName} src={candidate.avatarUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <BidiText as="p" className="truncate font-medium text-foreground">
          {candidate.displayName}
        </BidiText>
        <p className="truncate text-xs text-muted-foreground">
          {candidate.reasons.map((r, i) => (
            <React.Fragment key={r.field}>
              {i > 0 ? ' · ' : ''}
              {t('duplicates.reasonSame', { field: reasonFieldLabel(r.field, t) })}:{' '}
              {r.field === 'name' ? <BidiText>{r.value}</BidiText> : <LtrText>{r.value}</LtrText>}
            </React.Fragment>
          ))}
        </p>
      </div>
      <Badge tone={CONFIDENCE_TONE[candidate.confidence]}>{t(`duplicates.confidence.${candidate.confidence}`)}</Badge>
    </Link>
  );
}

function IntegrityFindingRow({ finding }: { finding: IntegrityFindingDTO }) {
  const t = useTranslations('dataQuality');
  return (
    <Link
      href={finding.link}
      className="flex items-start justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-surface-muted"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Badge tone={INTEGRITY_SEVERITY_TONE[finding.severity]} className="mt-0.5 shrink-0">
          {t(`integrity.severity.${finding.severity}`)}
        </Badge>
        <div className="min-w-0">
          <p className="text-foreground">{finding.title}</p>
          <p className="truncate text-xs text-muted-foreground">{finding.evidence}</p>
        </div>
      </div>
    </Link>
  );
}

export function DataQualityWorkspace({
  initialReport,
  initialDuplicates,
  initialIntegrityFindings,
  brands,
}: {
  initialReport: DataQualityReportDTO;
  initialDuplicates: DuplicateCandidateDTO[];
  initialIntegrityFindings: IntegrityFindingDTO[];
  brands: BrandSummaryDTO[];
}) {
  const t = useTranslations('dataQuality');
  const tCommon = useTranslations('common');
  const [brandId, setBrandId] = React.useState('');

  const reportQuery = useQuery({
    queryKey: ['data-quality-report', brandId] as const,
    queryFn: () => api.dataQuality.report(brandId || undefined),
    initialData: !brandId ? initialReport : undefined,
  });
  const duplicatesQuery = useQuery({
    queryKey: ['data-quality-duplicates', brandId] as const,
    queryFn: () => api.dataQuality.duplicates(brandId || undefined),
    initialData: !brandId ? initialDuplicates : undefined,
  });
  const integrityQuery = useQuery({
    queryKey: ['integrity-findings', brandId] as const,
    queryFn: () => api.integrityGuard.findings(brandId || undefined),
    initialData: !brandId ? initialIntegrityFindings : undefined,
  });

  const findings = reportQuery.data?.findings ?? [];
  const duplicates = duplicatesQuery.data ?? [];
  const integrityFindings = integrityQuery.data ?? [];
  const attentionCount = findings.filter((f) => (f.severity === 'critical' || f.severity === 'needsAttention') && f.count > 0).length;
  const integrityErrorCount = integrityFindings.filter((f) => f.severity === 'error').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={brandId || ALL} onValueChange={(v) => setBrandId(v === ALL ? '' : v)}>
          <SelectTrigger className="h-10 w-full sm:w-56">
            <SelectValue placeholder={t('brandFilterPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tCommon('allBrands')}</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                <BidiText>{b.name}</BidiText>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {reportQuery.data ? (
          <span className="text-xs text-muted-foreground">{t('lastChecked', { time: relativeTime(reportQuery.data.generatedAt) })}</span>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 text-muted-foreground" />
            {t('findings.cardTitle')}
            {attentionCount > 0 ? <Badge tone="warning">{t('findings.attentionBadge', { count: attentionCount })}</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          {reportQuery.isLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : findings.length === 0 ? (
            <EmptyState icon={ShieldQuestion} title={t('findings.emptyTitle')} description={t('findings.emptyDescription')} />
          ) : (
            <div className="divide-y divide-border/60">
              {findings.map((f) => (
                <FindingRow key={f.id} finding={f} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-muted-foreground" />
            {t('duplicates.cardTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          {duplicatesQuery.isLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : duplicates.length === 0 ? (
            <EmptyState icon={Info} title={t('duplicates.emptyTitle')} description={t('duplicates.emptyDescription')} />
          ) : (
            <div className="divide-y divide-border/60">
              {duplicates.map((c) => (
                <DuplicateRow key={c.influencerId} candidate={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            {t('integrity.cardTitle')}
            {integrityErrorCount > 0 ? <Badge tone="danger">{t('integrity.errorBadge', { count: integrityErrorCount })}</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          {integrityQuery.isLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : integrityFindings.length === 0 ? (
            <EmptyState icon={ShieldQuestion} title={t('integrity.emptyTitle')} description={t('integrity.emptyDescription')} />
          ) : (
            <div className="divide-y divide-border/60">
              {integrityFindings.map((f) => (
                <IntegrityFindingRow key={f.id} finding={f} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {reportQuery.isError || duplicatesQuery.isError || integrityQuery.isError ? (
        <EmptyState icon={AlertTriangle} title={t('loadError.title')} description={t('loadError.description')} />
      ) : null}
    </div>
  );
}
