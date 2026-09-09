'use client';

import * as React from 'react';
import { format, parseISO } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { API_PREFIX, type Platform, type SocialAccountDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { formatCompact } from '@/lib/format';
import { cn } from '@/lib/cn';

interface FollowerSeriesPoint {
  capturedAt: string;
  followers: number | null;
}

interface FollowerSeriesAccount {
  accountId: string;
  platform: Platform;
  username: string;
  points: FollowerSeriesPoint[];
}

const RANGES = [
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: 'all', label: 'All', days: null },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

/** Growth chart for an influencer's followers — one area series per synced social account. */
export function FollowerChart({
  influencerId,
  accounts,
}: {
  influencerId: string;
  accounts: SocialAccountDTO[];
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['influencer-followers', influencerId],
    queryFn: () => api.http.get<FollowerSeriesAccount[]>(`${API_PREFIX}/influencers/${influencerId}/followers`),
    enabled: accounts.length > 0,
  });

  const [accountId, setAccountId] = React.useState<string | null>(null);
  const [range, setRange] = React.useState<RangeKey>('90d');

  const series = React.useMemo(() => data ?? [], [data]);
  const activeId = accountId ?? series[0]?.accountId ?? null;
  const active = series.find((s) => s.accountId === activeId) ?? series[0];

  const points = React.useMemo(() => {
    if (!active) return [];
    const rangeDef = RANGES.find((r) => r.key === range);
    const cutoff = rangeDef?.days ? Date.now() - rangeDef.days * 24 * 60 * 60 * 1000 : null;
    return active.points
      .filter((p): p is { capturedAt: string; followers: number } => p.followers != null)
      .filter((p) => !cutoff || new Date(p.capturedAt).getTime() >= cutoff);
  }, [active, range]);

  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No social accounts linked"
        description="Growth charts appear once a social profile is connected."
        className="h-56 border-0 bg-transparent py-8"
      />
    );
  }

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-2xl" />;
  }

  if (isError || series.length === 0 || points.length === 0) {
    return (
      <EmptyState
        title="No growth history yet"
        description="Follower snapshots build up over time as this profile is synced."
        className="h-56 border-0 bg-transparent py-8"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {series.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {series.map((s) => (
              <button
                key={s.accountId}
                type="button"
                onClick={() => setAccountId(s.accountId)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  s.accountId === activeId
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-border bg-surface text-muted-foreground hover:bg-surface-muted',
                )}
              >
                <PlatformIcon platform={s.platform} className="h-3.5 w-3.5" />@{s.username}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="inline-flex items-center gap-1 rounded-lg bg-surface-muted p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                range === r.key ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="followerGrowthFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--brand))" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(var(--brand))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="capturedAt"
              tickFormatter={(d: string) => format(parseISO(d), 'MMM d')}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              tickFormatter={(v: number) => formatCompact(v)}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              formatter={(value: number) => [formatCompact(value), 'Followers']}
              labelFormatter={(d: string) => format(parseISO(d), 'MMM d, yyyy')}
              contentStyle={{
                borderRadius: 12,
                border: '1px solid hsl(var(--border))',
                background: 'hsl(var(--card))',
                fontSize: 12,
                boxShadow: '0 8px 24px -8px rgb(0 0 0 / 0.25)',
              }}
            />
            <Area
              type="monotone"
              dataKey="followers"
              stroke="hsl(var(--brand))"
              strokeWidth={2}
              fill="url(#followerGrowthFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
