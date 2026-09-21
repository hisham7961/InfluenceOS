'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CircleAlert, Fingerprint, Info, ShieldQuestion } from 'lucide-react';
import type { BrandSummaryDTO, DataQualityFindingDTO, DataQualityReportDTO, DuplicateCandidateDTO, Tone } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { relativeTime } from '@/lib/format';

const ALL = '__all__';

const SEVERITY_TONE: Record<DataQualityFindingDTO['severity'], Tone> = {
  critical: 'danger',
  needsAttention: 'warning',
  incomplete: 'info',
  informational: 'neutral',
};

const SEVERITY_LABEL: Record<DataQualityFindingDTO['severity'], string> = {
  critical: 'Critical',
  needsAttention: 'Needs attention',
  incomplete: 'Incomplete',
  informational: 'Informational',
};

const CONFIDENCE_TONE: Record<DuplicateCandidateDTO['confidence'], Tone> = {
  exact: 'danger',
  strongPossible: 'warning',
  possible: 'neutral',
};

const CONFIDENCE_LABEL: Record<DuplicateCandidateDTO['confidence'], string> = {
  exact: 'Likely the same creator',
  strongPossible: 'Possibly the same creator',
  possible: 'Worth a look',
};

const REASON_LABEL: Record<DuplicateCandidateDTO['reasons'][number]['field'], string> = {
  instagramUsername: 'Instagram',
  tiktokUsername: 'TikTok',
  youtubeUsername: 'YouTube',
  snapchatUsername: 'Snapchat',
  xUsername: 'X',
  email: 'Email',
  mobile: 'Mobile',
  whatsapp: 'WhatsApp',
  name: 'Name',
};

function FindingRow({ finding }: { finding: DataQualityFindingDTO }) {
  return (
    <Link
      href={finding.link}
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-surface-muted"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Badge tone={SEVERITY_TONE[finding.severity]}>{SEVERITY_LABEL[finding.severity]}</Badge>
        <span className="truncate text-foreground">{finding.title}</span>
      </div>
      <span className={finding.count > 0 ? 'font-semibold tabular-nums text-foreground' : 'tabular-nums text-muted-foreground'}>
        {finding.count}
      </span>
    </Link>
  );
}

function DuplicateRow({ candidate }: { candidate: DuplicateCandidateDTO }) {
  return (
    <Link
      href={`/influencers/${candidate.influencerId}`}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-surface-muted"
    >
      <Avatar name={candidate.displayName} src={candidate.avatarUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{candidate.displayName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {candidate.reasons.map((r) => `Same ${REASON_LABEL[r.field]}: ${r.value}`).join(' · ')}
        </p>
      </div>
      <Badge tone={CONFIDENCE_TONE[candidate.confidence]}>{CONFIDENCE_LABEL[candidate.confidence]}</Badge>
    </Link>
  );
}

export function DataQualityWorkspace({
  initialReport,
  initialDuplicates,
  brands,
}: {
  initialReport: DataQualityReportDTO;
  initialDuplicates: DuplicateCandidateDTO[];
  brands: BrandSummaryDTO[];
}) {
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

  const findings = reportQuery.data?.findings ?? [];
  const duplicates = duplicatesQuery.data ?? [];
  const attentionCount = findings.filter((f) => (f.severity === 'critical' || f.severity === 'needsAttention') && f.count > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={brandId || ALL} onValueChange={(v) => setBrandId(v === ALL ? '' : v)}>
          <SelectTrigger className="h-10 w-full sm:w-56">
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
        {reportQuery.data ? (
          <span className="text-xs text-muted-foreground">Last checked {relativeTime(reportQuery.data.generatedAt)}</span>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 text-muted-foreground" />
            Data Quality Findings
            {attentionCount > 0 ? <Badge tone="warning">{attentionCount} need attention</Badge> : null}
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
            <EmptyState icon={ShieldQuestion} title="Nothing to check yet" description="No creators, campaigns or deliverables to evaluate." />
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
            Possible Duplicate Creators
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
            <EmptyState icon={Info} title="No possible duplicates found" description="No two creator records share a handle, email, phone or name right now." />
          ) : (
            <div className="divide-y divide-border/60">
              {duplicates.map((c) => (
                <DuplicateRow key={c.influencerId} candidate={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {reportQuery.isError || duplicatesQuery.isError ? (
        <EmptyState icon={AlertTriangle} title="Couldn't load data quality" description="Try reloading the page." />
      ) : null}
    </div>
  );
}
