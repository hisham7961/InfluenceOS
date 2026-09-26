'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  DatabaseBackup,
  ExternalLink,
  Flag,
  Globe,
  Layers,
  Search,
  Server,
  ShieldCheck,
  Smartphone,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type {
  ApiEndpointDTO,
  ApiModuleDTO,
  BackupKindStatusDTO,
  BackupStatusDTO,
  FeatureClass,
  FeatureDTO,
  FeatureStatus,
  HealthComponentDTO,
  PlatformStatusDTO,
  Tone,
} from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { formatBytes, useLocalizedFormat } from '@/lib/format';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { errorMessage as apiErrorMessage } from '@/lib/errors';

const API_DOCS_URL = `${(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '')}/api/docs`;

const HEALTH_TONE: Record<HealthComponentDTO['status'], Tone> = {
  ok: 'success',
  degraded: 'warning',
  down: 'danger',
  unknown: 'neutral',
};

const HEALTH_DOT: Record<HealthComponentDTO['status'], string> = {
  ok: 'bg-success',
  degraded: 'bg-warning',
  down: 'bg-danger',
  unknown: 'bg-muted-foreground',
};

const FEATURE_CLASS_TONE: Record<FeatureClass, Tone> = {
  SHARED: 'success',
  WEB_ONLY_BY_DESIGN: 'info',
  MOBILE_ONLY_BY_DESIGN: 'accent',
  ADMIN_DESKTOP_ONLY: 'warning',
};

const FEATURE_STATUS_TONE: Record<FeatureStatus, Tone> = {
  READY: 'success',
  PARTIAL: 'warning',
  PLANNED: 'neutral',
  ADMIN_SERVER_ONLY: 'accent',
  NOT_EXPOSED: 'danger',
};

const METHOD_TONE: Record<string, Tone> = {
  GET: 'info',
  POST: 'success',
  PATCH: 'warning',
  PUT: 'warning',
  DELETE: 'danger',
};

const AUTH_TONE: Record<ApiEndpointDTO['auth'], Tone> = {
  public: 'neutral',
  user: 'info',
  admin: 'accent',
};

const FEATURE_CLASS_ORDER: FeatureClass[] = [
  'SHARED',
  'WEB_ONLY_BY_DESIGN',
  'MOBILE_ONLY_BY_DESIGN',
  'ADMIN_DESKTOP_ONLY',
];

export function PlatformClient({
  status,
  modules,
  features,
  endpoints,
}: {
  status: PlatformStatusDTO;
  modules: ApiModuleDTO[];
  features: FeatureDTO[];
  endpoints: ApiEndpointDTO[];
}) {
  const t = useTranslations('settings');
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">{t('platform.tabs.overview')}</TabsTrigger>
        <TabsTrigger value="modules">{t('platform.tabs.modules')}</TabsTrigger>
        <TabsTrigger value="mobile">{t('platform.tabs.mobile')}</TabsTrigger>
        <TabsTrigger value="explorer">{t('platform.tabs.explorer')}</TabsTrigger>
        <TabsTrigger value="flags">{t('platform.tabs.flags')}</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <OverviewTab status={status} />
      </TabsContent>
      <TabsContent value="modules">
        <ModulesTab modules={modules} />
      </TabsContent>
      <TabsContent value="mobile">
        <MobileReadinessTab features={features} />
      </TabsContent>
      <TabsContent value="explorer">
        <ExplorerTab endpoints={endpoints} />
      </TabsContent>
      <TabsContent value="flags">
        <FlagsTab />
      </TabsContent>
    </Tabs>
  );
}

/* ------------------------------------------------------------------------ */
/* Overview                                                                  */
/* ------------------------------------------------------------------------ */

function ReadinessRing({
  percent,
  readyLabel,
  size = 132,
  strokeWidth = 11,
}: {
  percent: number;
  readyLabel: string;
  size?: number;
  strokeWidth?: number;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const tone = clamped >= 80 ? 'stroke-success' : clamped >= 50 ? 'stroke-warning' : 'stroke-danger';

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} className="fill-none stroke-surface-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn('fill-none transition-[stroke-dashoffset] duration-700 ease-out', tone)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tracking-tight">{Math.round(clamped)}%</span>
        <span className="text-[11px] text-muted-foreground">{readyLabel}</span>
      </div>
    </div>
  );
}

type CoverageTone = 'neutral' | 'info' | 'accent' | 'success' | 'warning';

function formatUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function InfoTile({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-sm font-semibold', capitalize && 'capitalize')}>{value}</p>
    </div>
  );
}

function CoverageTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: CoverageTone;
}) {
  const toneStyles: Record<CoverageTone, string> = {
    neutral: 'bg-surface-muted text-muted-foreground',
    info: 'bg-info/10 text-info',
    accent: 'bg-accent/10 text-accent',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
  };
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', toneStyles[tone])}>
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xl font-semibold tracking-tight">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function BackupRow({ label, run }: { label: string; run: BackupKindStatusDTO }) {
  const t = useTranslations('settings');
  const { relativeTime, dateTime } = useLocalizedFormat();
  const failedSince = run.lastFailureAt && (!run.lastSuccessAt || run.lastFailureAt > run.lastSuccessAt);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground" title={run.lastSuccessAt ? dateTime(run.lastSuccessAt) : undefined}>
          {run.lastSuccessAt
            ? t('platform.backups.lastGood', { when: relativeTime(run.lastSuccessAt) })
            : t('platform.backups.never')}
          {run.sizeBytes != null ? ` · ${formatBytes(run.sizeBytes)}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {failedSince ? <Badge tone="danger">{t('platform.backups.failedLast')}</Badge> : null}
        {run.lastSuccessAt ? (
          <Badge tone={run.offsite ? 'success' : 'warning'}>
            {run.offsite ? t('platform.backups.offsite') : t('platform.backups.localOnly')}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

function BackupsCard({ backups }: { backups: BackupStatusDTO }) {
  const t = useTranslations('settings');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup className="h-4 w-4 text-brand" /> {t('platform.backups.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {backups.stale ? (
          <div className="mb-2 flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{t('platform.backups.staleWarning')}</p>
          </div>
        ) : null}
        <div className="divide-y divide-border">
          <BackupRow label={t('platform.backups.database')} run={backups.database} />
          <BackupRow label={t('platform.backups.files')} run={backups.files} />
          <BackupRow label={t('platform.backups.restoreTest')} run={backups.restoreTest} />
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewTab({ status }: { status: PlatformStatusDTO }) {
  const t = useTranslations('settings');
  const { coverage } = status;

  return (
    <div className="space-y-7">
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4 text-brand" /> {t('platform.overview.systemStatus')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-5 pt-0 sm:grid-cols-4">
            <InfoTile label={t('platform.overview.apiVersion')} value={status.apiVersion} />
            <InfoTile label={t('platform.overview.environment')} value={status.environment} capitalize />
            <InfoTile label={t('platform.overview.backendVersion')} value={status.backendVersion} />
            <InfoTile label={t('platform.overview.webVersion')} value={status.webVersion} />
            <InfoTile
              label={t('platform.overview.gitSha')}
              value={status.gitSha === 'unknown' ? '—' : status.gitSha.slice(0, 12)}
            />
            <InfoTile
              label={t('platform.overview.built')}
              value={status.buildTime ? new Date(status.buildTime).toLocaleString() : '—'}
            />
            <InfoTile label={t('platform.overview.uptime')} value={formatUptime(status.uptimeSec)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-brand" /> {t('platform.overview.mobileReadiness')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center pt-0">
            <ReadinessRing percent={status.mobileReadinessPercent} readyLabel={t('platform.overview.ready')} />
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">{t('platform.overview.componentHealth')}</h3>
        {status.health.length === 0 ? (
          <EmptyState icon={Activity} title={t('platform.overview.noHealthSignals')} className="py-10" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {status.health.map((h) => (
              <Card key={h.name} className="transition-shadow hover:shadow-pop">
                <CardContent className="flex items-start gap-3 p-4">
                  <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', HEALTH_DOT[h.status])} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{h.name}</p>
                      <Badge tone={HEALTH_TONE[h.status]} className="shrink-0">
                        {t(`platform.health.${h.status}`)}
                      </Badge>
                    </div>
                    {h.detail ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{h.detail}</p> : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <BackupsCard backups={status.backups} />

      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">{t('platform.overview.featureCoverage')}</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <CoverageTile
            label={t('platform.overview.coverage.totalFeatures')}
            value={coverage.totalFeatures}
            icon={Layers}
            tone="neutral"
          />
          <CoverageTile
            label={t('platform.overview.coverage.apiReady')}
            value={coverage.apiReady}
            icon={Server}
            tone="info"
          />
          <CoverageTile
            label={t('platform.overview.coverage.webReady')}
            value={coverage.webReady}
            icon={Globe}
            tone="accent"
          />
          <CoverageTile
            label={t('platform.overview.coverage.mobileReady')}
            value={coverage.mobileReady}
            icon={Smartphone}
            tone="success"
          />
          <CoverageTile
            label={t('platform.overview.coverage.adminOnly')}
            value={coverage.adminOnly}
            icon={ShieldCheck}
            tone="warning"
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* API Modules                                                               */
/* ------------------------------------------------------------------------ */

function ReadyMark({ ok }: { ok: boolean }) {
  const t = useTranslations('settings');
  return ok ? (
    <CheckCircle2 className="h-4 w-4 text-success" aria-label={t('platform.modulesTab.ready')} />
  ) : (
    <XCircle className="h-4 w-4 text-muted-foreground/40" aria-label={t('platform.modulesTab.notReady')} />
  );
}

function ModulesTab({ modules }: { modules: ApiModuleDTO[] }) {
  const t = useTranslations('settings');
  if (modules.length === 0) {
    return <EmptyState icon={Layers} title={t('platform.modulesTab.empty')} className="py-14" />;
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted/60 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3">{t('platform.modulesTab.module')}</th>
              <th className="px-5 py-3 text-center">{t('platform.modulesTab.apiReady')}</th>
              <th className="px-5 py-3 text-center">{t('platform.modulesTab.webIntegrated')}</th>
              <th className="px-5 py-3 text-center">{t('platform.modulesTab.mobileReady')}</th>
              <th className="px-5 py-3">{t('platform.modulesTab.version')}</th>
              <th className="px-5 py-3 text-end">{t('platform.modulesTab.endpoints')}</th>
              <th className="px-5 py-3 text-end">{t('platform.modulesTab.docs')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {modules.map((m) => (
              <tr key={m.key} className="transition-colors hover:bg-surface-muted/50">
                <td className="px-5 py-3.5 font-medium">{m.name}</td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-center">
                    <ReadyMark ok={m.apiReady} />
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-center">
                    <ReadyMark ok={m.webIntegrated} />
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-center">
                    <ReadyMark ok={m.mobileReady} />
                  </div>
                </td>
                <td className="px-5 py-3.5 text-muted-foreground">{m.version}</td>
                <td className="px-5 py-3.5 text-end tabular-nums text-muted-foreground">{m.endpointCount}</td>
                <td className="px-5 py-3.5 text-end">
                  <Link
                    href={API_DOCS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                  >
                    {t('platform.modulesTab.docs')} <ExternalLink className="h-3 w-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Mobile Readiness                                                          */
/* ------------------------------------------------------------------------ */

function FeatureStatusCell({ status }: { status: FeatureStatus }) {
  const t = useTranslations('settings');
  if (status === 'READY') return <CheckCircle2 className="h-4 w-4 text-success" aria-label={t('platform.modulesTab.ready')} />;
  return (
    <Badge tone={FEATURE_STATUS_TONE[status]} className="whitespace-nowrap">
      {t(`platform.featureStatus.${status}`)}
    </Badge>
  );
}

function MobileReadinessTab({ features }: { features: FeatureDTO[] }) {
  const t = useTranslations('settings');
  const groups = React.useMemo(() => {
    const map = new Map<FeatureClass, FeatureDTO[]>();
    for (const f of features) {
      const list = map.get(f.classification) ?? [];
      list.push(f);
      map.set(f.classification, list);
    }
    return FEATURE_CLASS_ORDER.map((cls) => ({ cls, items: map.get(cls) ?? [] })).filter((g) => g.items.length > 0);
  }, [features]);

  if (features.length === 0) {
    return <EmptyState icon={Smartphone} title={t('platform.mobileTab.empty')} className="py-14" />;
  }

  return (
    <div className="space-y-7">
      {groups.map(({ cls, items }) => (
        <div key={cls}>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{t(`platform.featureClass.${cls}`)}</h3>
            <Badge tone={FEATURE_CLASS_TONE[cls]}>{items.length}</Badge>
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/60 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3">{t('platform.mobileTab.feature')}</th>
                    <th className="px-5 py-3 text-center">{t('platform.mobileTab.api')}</th>
                    <th className="px-5 py-3 text-center">{t('platform.mobileTab.web')}</th>
                    <th className="px-5 py-3 text-center">{t('platform.mobileTab.mobileReady')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((f) => (
                    <tr key={f.key} className="transition-colors hover:bg-surface-muted/50">
                      <td className="px-5 py-3.5">
                        <p className="font-medium">{f.name}</p>
                        <p className="text-xs text-muted-foreground">{f.description}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex justify-center">
                          <FeatureStatusCell status={f.apiStatus} />
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex justify-center">
                          <FeatureStatusCell status={f.webStatus} />
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex justify-center">
                          <ReadyMark ok={f.mobileReady} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* API Explorer                                                              */
/* ------------------------------------------------------------------------ */

function ExplorerTab({ endpoints }: { endpoints: ApiEndpointDTO[] }) {
  const t = useTranslations('settings');
  const [q, setQ] = React.useState('');

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return endpoints;
    return endpoints.filter(
      (e) =>
        e.path.toLowerCase().includes(needle) ||
        e.module.toLowerCase().includes(needle) ||
        e.method.toLowerCase().includes(needle) ||
        e.summary.toLowerCase().includes(needle),
    );
  }, [q, endpoints]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('platform.explorer.searchPlaceholder')}
            className="ps-9"
          />
        </div>
        <Link
          href={API_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          <BookOpen className="h-4 w-4" /> {t('platform.explorer.fullDocs')} <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t('platform.explorer.emptyTitle')}
          description={t('platform.explorer.emptyDescription')}
          className="py-14"
        />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {filtered.map((e) => (
            <div
              key={`${e.method}-${e.path}`}
              className="flex flex-wrap items-center gap-3 p-4 transition-colors hover:bg-surface-muted/50"
            >
              <Badge tone={METHOD_TONE[e.method.toUpperCase()] ?? 'neutral'} className="w-16 shrink-0 justify-center font-mono">
                {e.method.toUpperCase()}
              </Badge>
              <div className="min-w-0 flex-1">
                <code className="block truncate font-mono text-sm">{e.path}</code>
                {e.summary ? <p className="truncate text-xs text-muted-foreground">{e.summary}</p> : null}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{e.module}</span>
              <Badge tone={AUTH_TONE[e.auth]} className="shrink-0">
                {t(`platform.explorer.auth.${e.auth}`)}
              </Badge>
            </div>
          ))}
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        {t('platform.explorer.countOfTotal', { filtered: filtered.length, total: endpoints.length })}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Feature Flags                                                             */
/* ------------------------------------------------------------------------ */

type PlatformFlag = { key: string; description: string | null; scope: string; enabled: boolean };

function FlagsTab() {
  const t = useTranslations('settings');
  const errorMessage = React.useCallback(
    (e: unknown) => (apiErrorMessage(e, t('platform.errorGeneric'))),
    [t],
  );
  const queryClient = useQueryClient();
  const flagsQuery = useQuery({
    queryKey: ['platform-flags'],
    queryFn: () => api.platform.flags(),
  });

  const setFlag = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => api.platform.setFlag(key, enabled),
    onMutate: async ({ key, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['platform-flags'] });
      const previous = queryClient.getQueryData<PlatformFlag[]>(['platform-flags']);
      queryClient.setQueryData<PlatformFlag[]>(['platform-flags'], (old) =>
        old?.map((f) => (f.key === key ? { ...f, enabled } : f)),
      );
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['platform-flags'], ctx.previous);
      toast.error(errorMessage(e));
    },
    onSuccess: (_data, { key, enabled }) => {
      toast.success(t(enabled ? 'platform.flags.toastEnabled' : 'platform.flags.toastDisabled', { key }));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['platform-flags'] }),
  });

  if (flagsQuery.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <SkeletonText lines={2} className="w-2/3" />
              <Skeleton className="h-5 w-9 rounded-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (flagsQuery.isError) {
    return (
      <EmptyState
        icon={Flag}
        title={t('platform.flags.loadErrorTitle')}
        description={errorMessage(flagsQuery.error)}
        className="py-14"
      />
    );
  }

  const flags = flagsQuery.data ?? [];

  if (flags.length === 0) {
    return <EmptyState icon={Flag} title={t('platform.flags.empty')} className="py-14" />;
  }

  return (
    <div className="space-y-3">
      {flags.map((f) => (
        <Card key={f.key} className="transition-shadow hover:shadow-pop">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-sm font-medium">{f.key}</p>
                <Badge tone="neutral">{f.scope}</Badge>
              </div>
              {f.description ? <p className="mt-0.5 text-xs text-muted-foreground">{f.description}</p> : null}
            </div>
            <Switch
              checked={f.enabled}
              disabled={setFlag.isPending && setFlag.variables?.key === f.key}
              onCheckedChange={(checked) => setFlag.mutate({ key: f.key, enabled: checked })}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
