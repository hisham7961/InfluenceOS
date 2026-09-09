'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity,
  BookOpen,
  CheckCircle2,
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
  FeatureClass,
  FeatureDTO,
  FeatureStatus,
  HealthComponentDTO,
  PlatformStatusDTO,
  Tone,
} from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

const API_DOCS_URL = `${(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '')}/api/docs`;

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
}

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

const HEALTH_LABEL: Record<HealthComponentDTO['status'], string> = {
  ok: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'Unknown',
};

const FEATURE_CLASS_LABEL: Record<FeatureClass, string> = {
  SHARED: 'Shared — Web + Mobile',
  WEB_ONLY_BY_DESIGN: 'Web only, by design',
  MOBILE_ONLY_BY_DESIGN: 'Mobile only, by design',
  ADMIN_DESKTOP_ONLY: 'Admin desktop only',
};

const FEATURE_CLASS_TONE: Record<FeatureClass, Tone> = {
  SHARED: 'success',
  WEB_ONLY_BY_DESIGN: 'info',
  MOBILE_ONLY_BY_DESIGN: 'accent',
  ADMIN_DESKTOP_ONLY: 'warning',
};

const FEATURE_STATUS_LABEL: Record<FeatureStatus, string> = {
  READY: 'Ready',
  PARTIAL: 'Partial',
  PLANNED: 'Planned',
  ADMIN_SERVER_ONLY: 'Admin/server only',
  NOT_EXPOSED: 'Not exposed',
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
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="modules">API Modules</TabsTrigger>
        <TabsTrigger value="mobile">Mobile Readiness</TabsTrigger>
        <TabsTrigger value="explorer">API Explorer</TabsTrigger>
        <TabsTrigger value="flags">Feature Flags</TabsTrigger>
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

function ReadinessRing({ percent, size = 132, strokeWidth = 11 }: { percent: number; size?: number; strokeWidth?: number }) {
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
        <span className="text-[11px] text-muted-foreground">ready</span>
      </div>
    </div>
  );
}

type CoverageTone = 'neutral' | 'info' | 'accent' | 'success' | 'warning';

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

function OverviewTab({ status }: { status: PlatformStatusDTO }) {
  const { coverage } = status;

  return (
    <div className="space-y-7">
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4 text-brand" /> System status
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-5 pt-0 sm:grid-cols-4">
            <InfoTile label="API version" value={status.apiVersion} />
            <InfoTile label="Environment" value={status.environment} capitalize />
            <InfoTile label="Backend version" value={status.backendVersion} />
            <InfoTile label="Web version" value={status.webVersion} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-brand" /> Mobile readiness
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center pt-0">
            <ReadinessRing percent={status.mobileReadinessPercent} />
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Component health</h3>
        {status.health.length === 0 ? (
          <EmptyState icon={Activity} title="No health signals reported" className="py-10" />
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
                        {HEALTH_LABEL[h.status]}
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

      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Feature coverage</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <CoverageTile label="Total features" value={coverage.totalFeatures} icon={Layers} tone="neutral" />
          <CoverageTile label="API ready" value={coverage.apiReady} icon={Server} tone="info" />
          <CoverageTile label="Web ready" value={coverage.webReady} icon={Globe} tone="accent" />
          <CoverageTile label="Mobile ready" value={coverage.mobileReady} icon={Smartphone} tone="success" />
          <CoverageTile label="Admin only" value={coverage.adminOnly} icon={ShieldCheck} tone="warning" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* API Modules                                                               */
/* ------------------------------------------------------------------------ */

function ReadyMark({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="h-4 w-4 text-success" aria-label="Ready" />
  ) : (
    <XCircle className="h-4 w-4 text-muted-foreground/40" aria-label="Not ready" />
  );
}

function ModulesTab({ modules }: { modules: ApiModuleDTO[] }) {
  if (modules.length === 0) {
    return <EmptyState icon={Layers} title="No API modules registered" className="py-14" />;
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted/60 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3">Module</th>
              <th className="px-5 py-3 text-center">API ready</th>
              <th className="px-5 py-3 text-center">Web integrated</th>
              <th className="px-5 py-3 text-center">Mobile ready</th>
              <th className="px-5 py-3">Version</th>
              <th className="px-5 py-3 text-right">Endpoints</th>
              <th className="px-5 py-3 text-right">Docs</th>
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
                <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">{m.endpointCount}</td>
                <td className="px-5 py-3.5 text-right">
                  <Link
                    href={API_DOCS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                  >
                    Docs <ExternalLink className="h-3 w-3" />
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
  if (status === 'READY') return <CheckCircle2 className="h-4 w-4 text-success" aria-label="Ready" />;
  return (
    <Badge tone={FEATURE_STATUS_TONE[status]} className="whitespace-nowrap">
      {FEATURE_STATUS_LABEL[status]}
    </Badge>
  );
}

function MobileReadinessTab({ features }: { features: FeatureDTO[] }) {
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
    return <EmptyState icon={Smartphone} title="No features registered" className="py-14" />;
  }

  return (
    <div className="space-y-7">
      {groups.map(({ cls, items }) => (
        <div key={cls}>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{FEATURE_CLASS_LABEL[cls]}</h3>
            <Badge tone={FEATURE_CLASS_TONE[cls]}>{items.length}</Badge>
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/60 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3">Feature</th>
                    <th className="px-5 py-3 text-center">API</th>
                    <th className="px-5 py-3 text-center">Web</th>
                    <th className="px-5 py-3 text-center">Mobile ready</th>
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
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search endpoints by path, module, or method…"
            className="pl-9"
          />
        </div>
        <Link
          href={API_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          <BookOpen className="h-4 w-4" /> Full API docs <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Search} title="No matching endpoints" description="Try a different search term." className="py-14" />
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
                {e.auth}
              </Badge>
            </div>
          ))}
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        {filtered.length} of {endpoints.length} endpoints
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Feature Flags                                                             */
/* ------------------------------------------------------------------------ */

type PlatformFlag = { key: string; description: string | null; scope: string; enabled: boolean };

function FlagsTab() {
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
      toast.success(`${key} ${enabled ? 'enabled' : 'disabled'}.`);
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
        title="Couldn't load feature flags"
        description={errorMessage(flagsQuery.error)}
        className="py-14"
      />
    );
  }

  const flags = flagsQuery.data ?? [];

  if (flags.length === 0) {
    return <EmptyState icon={Flag} title="No feature flags configured" className="py-14" />;
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
