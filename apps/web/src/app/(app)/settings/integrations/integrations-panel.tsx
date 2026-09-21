'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Info,
  Plug,
  PlugZap,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { IntegrationCapabilityDTO, IntegrationDTO, IntegrationStatus, Platform, Tone } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import type { CapabilityLevel } from '@influenceos/shared';
import { PLATFORMS } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { dateTime, relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { PlatformBadge } from '@/components/ui/platform-badge';

const STATUS_TONE: Record<IntegrationStatus, Tone> = {
  ENABLED: 'success',
  DISABLED: 'neutral',
  NOT_CONFIGURED: 'warning',
  ERROR: 'danger',
};

const LEVEL_TONE: Record<CapabilityLevel, Tone> = {
  YES: 'success',
  YES_WITH_API: 'success',
  CONDITIONAL: 'info',
  AUTHORIZATION_DEPENDENT: 'warning',
  MANUAL: 'neutral',
  NO: 'danger',
};

/** Rows shown in the capability matrix, in display order (spec §42). */
const CAPABILITY_ROWS: { key: keyof IntegrationCapabilityDTO; labelKey: string }[] = [
  { key: 'profileLookup', labelKey: 'profileLookup' },
  { key: 'followerSync', labelKey: 'followerSync' },
  { key: 'contentEmbed', labelKey: 'contentEmbed' },
  { key: 'contentMetrics', labelKey: 'contentMetrics' },
  { key: 'availabilityMonitoring', labelKey: 'availabilityMonitoring' },
];

function isCapabilityLevel(value: string): value is CapabilityLevel {
  return value in LEVEL_TONE;
}

function levelTone(value: string): Tone {
  return isCapabilityLevel(value) ? LEVEL_TONE[value] : 'neutral';
}

/**
 * Admin integrations panel (spec §42): one card per social platform explaining
 * exactly how it connects today, its live test status, and — most importantly —
 * the graded capability matrix so nobody assumes a platform can do more than it
 * actually can (e.g. TikTok profile sync requires creator authorization this
 * product intentionally does not perform).
 */
export function IntegrationsPanel({ initial }: { initial: IntegrationDTO[] }) {
  const t = useTranslations('settings');
  const errorMessage = React.useCallback(
    (e: unknown) => (e instanceof ApiError ? e.message : t('integrations.errorGeneric')),
    [t],
  );
  const query = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.integrations.list(),
    initialData: initial,
  });

  const integrations = React.useMemo(() => {
    const order = new Map(PLATFORMS.map((p, i) => [p, i]));
    return [...(query.data ?? [])].sort(
      (a, b) => (order.get(a.platform) ?? 99) - (order.get(b.platform) ?? 99),
    );
  }, [query.data]);

  if (query.isLoading) return <IntegrationsSkeleton />;

  if (query.isError) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title={t('integrations.loadErrorTitle')}
        description={errorMessage(query.error)}
        action={
          <Button variant="outline" onClick={() => query.refetch()}>
            <RefreshCcw className="h-4 w-4" />
            {t('integrations.tryAgain')}
          </Button>
        }
      />
    );
  }

  if (integrations.length === 0) {
    return (
      <EmptyState
        icon={Plug}
        title={t('integrations.empty.title')}
        description={t('integrations.empty.description')}
      />
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {integrations.map((integration) => (
        <IntegrationCard key={integration.platform} integration={integration} />
      ))}
    </div>
  );
}

function IntegrationCard({ integration }: { integration: IntegrationDTO }) {
  const t = useTranslations('settings');
  const errorMessage = React.useCallback(
    (e: unknown) => (e instanceof ApiError ? e.message : t('integrations.errorGeneric')),
    [t],
  );
  const queryClient = useQueryClient();
  const { platform, status, isEnabled, monitoringEnabled, lastTestAt, lastSuccessAt, lastError, capabilities } =
    integration;

  function applyUpdate(next: IntegrationDTO) {
    queryClient.setQueryData<IntegrationDTO[]>(['integrations'], (old) =>
      old ? old.map((i) => (i.platform === next.platform ? next : i)) : old,
    );
  }

  const updateEnabled = useMutation({
    mutationFn: (nextEnabled: boolean) => api.integrations.update(platform, { isEnabled: nextEnabled }),
    onSuccess: (updated) => {
      applyUpdate(updated);
      toast.success(
        updated.isEnabled
          ? t('integrations.toastEnabled', { platform: platformLabel(platform) })
          : t('integrations.toastDisabled', { platform: platformLabel(platform) }),
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const testConnection = useMutation({
    mutationFn: () => api.integrations.test(platform),
    onSuccess: (result) => {
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card className="flex flex-col overflow-hidden transition-shadow duration-200 hover:shadow-elevated">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <PlatformBadge platform={platform} size="md" />
          <div className="flex flex-col gap-1">
            <Badge tone={STATUS_TONE[status]} className="w-fit">
              {t(`integrations.status.${status}`)}
            </Badge>
            {monitoringEnabled ? (
              <span className="text-[11px] text-muted-foreground">{t('integrations.monitoringActive')}</span>
            ) : (
              <span className="text-[11px] text-muted-foreground">{t('integrations.monitoringOff')}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <Switch
              checked={isEnabled}
              disabled={updateEnabled.isPending}
              onCheckedChange={(checked) => updateEnabled.mutate(checked)}
              aria-label={t(isEnabled ? 'integrations.disableAria' : 'integrations.enableAria', {
                platform: platformLabel(platform),
              })}
            />
            <span className="text-sm text-muted-foreground">
              {isEnabled ? t('integrations.status.ENABLED') : t('integrations.status.DISABLED')}
            </span>
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={testConnection.isPending}
            onClick={() => testConnection.mutate()}
          >
            {testConnection.isPending ? <Spinner className="h-3.5 w-3.5" /> : <PlugZap className="h-3.5 w-3.5" />}
            {t('integrations.testConnection')}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-5 pt-5">
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:grid-cols-3">
          <div title={lastTestAt ? dateTime(lastTestAt) : undefined}>
            <span className="font-medium text-foreground">{t('integrations.lastTested')}</span>{' '}
            {lastTestAt ? relativeTime(lastTestAt) : t('integrations.never')}
          </div>
          <div title={lastSuccessAt ? dateTime(lastSuccessAt) : undefined}>
            <span className="font-medium text-foreground">{t('integrations.lastSuccess')}</span>{' '}
            {lastSuccessAt ? relativeTime(lastSuccessAt) : t('integrations.never')}
          </div>
          <div className={cn(lastError && 'text-danger')}>
            <span className={cn('font-medium', lastError ? 'text-danger' : 'text-foreground')}>
              {t('integrations.lastError')}
            </span>{' '}
            {lastError ? <span className="line-clamp-1">{lastError}</span> : t('integrations.none')}
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-surface-muted/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('integrations.whatsPossible')}
          </p>
          <div className="divide-y divide-border/70">
            {CAPABILITY_ROWS.map((row) => {
              const value = String(capabilities[row.key]);
              return (
                <div key={row.key} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="text-sm text-foreground">{t(`integrations.capabilityRow.${row.labelKey}`)}</span>
                  <Badge tone={levelTone(value)}>
                    {isCapabilityLevel(value) ? t(`integrations.level.${value}`) : value}
                  </Badge>
                </div>
              );
            })}
          </div>

          {capabilities.requiresCreatorAuthorization || capabilities.requiresAppAuthorization ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {capabilities.requiresCreatorAuthorization ? (
                <Badge tone="warning" className="gap-1">
                  <ShieldAlert className="h-3 w-3" />
                  {t('integrations.requiresCreatorAuth')}
                </Badge>
              ) : null}
              {capabilities.requiresAppAuthorization ? (
                <Badge tone="warning" className="gap-1">
                  <ShieldAlert className="h-3 w-3" />
                  {t('integrations.requiresAppAuth')}
                </Badge>
              ) : null}
              {capabilities.manualFallback ? (
                <Badge tone="neutral" className="gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  {t('integrations.manualFallback')}
                </Badge>
              ) : null}
            </div>
          ) : null}

          {capabilities.notes ? (
            <p className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {capabilities.notes}
            </p>
          ) : null}
        </div>

        {status === 'NOT_CONFIGURED' ? (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('integrations.notConfiguredWarning', { platform: platformLabel(platform) })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function platformLabel(platform: Platform): string {
  return platform.charAt(0) + platform.slice(1).toLowerCase();
}

function IntegrationsSkeleton() {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {Array.from({ length: PLATFORMS.length }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-28 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-8 w-32 rounded-lg" />
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
