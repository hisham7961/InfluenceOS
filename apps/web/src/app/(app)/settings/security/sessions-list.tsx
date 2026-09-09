'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  LogOut,
  Monitor,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import type { DeviceSessionDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { dateTime, relativeTime, shortDate } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const SESSIONS_KEY = ['auth', 'sessions'] as const;

type Confirm = { kind: 'one'; session: DeviceSessionDTO } | { kind: 'all' } | null;

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
}

function clientIcon(session: DeviceSessionDTO): LucideIcon {
  const s = `${session.client} ${session.deviceName ?? ''}`.toLowerCase();
  return /ios|android|iphone|ipad|mobile|phone|tablet/.test(s) ? Smartphone : Monitor;
}

function sessionLabel(session: DeviceSessionDTO): string {
  return session.deviceName ?? session.client;
}

/**
 * Active device sessions (spec item 28). Lists every session signed in to the
 * current account, flags the one you're using now, and lets you revoke any of
 * them individually or all others at once. There is no bulk-revoke endpoint, so
 * "revoke all other sessions" simply loops `revokeSession` over the rest.
 */
export function SessionsList() {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = React.useState<Confirm>(null);

  const query = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => api.auth.sessions(),
  });

  const sessions = React.useMemo(() => {
    // Current session first, then most recently active.
    return [...(query.data ?? [])].sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
    });
  }, [query.data]);

  const others = React.useMemo(() => sessions.filter((s) => !s.current), [sessions]);

  const revokeOne = useMutation({
    mutationFn: (id: string) => api.auth.revokeSession(id),
    onSuccess: () => {
      toast.success('Session revoked.');
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const revokeAll = useMutation({
    // No bulk endpoint — revoke each non-current session in turn.
    mutationFn: async () => {
      for (const s of others) {
        await api.auth.revokeSession(s.id);
      }
    },
    onSuccess: () => {
      toast.success('Signed out of all other sessions.');
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
    onError: (e) => {
      // Some may have been revoked before the failure — refresh either way.
      toast.error(errorMessage(e));
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });

  const pending = revokeOne.isPending || revokeAll.isPending;

  if (query.isLoading) return <SessionsSkeleton />;

  if (query.isError) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Couldn't load sessions"
        description={errorMessage(query.error)}
        action={
          <Button variant="outline" onClick={() => query.refetch()}>
            <RefreshCcw className="h-4 w-4" />
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Active sessions
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Devices currently signed in to your account. Revoke any you don&apos;t recognise.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={others.length === 0 || pending}
          onClick={() => setConfirm({ kind: 'all' })}
        >
          <LogOut className="h-3.5 w-3.5" />
          Revoke all other sessions
        </Button>
      </CardHeader>

      <CardContent className="pt-0">
        {sessions.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No active sessions found.</p>
        ) : (
          <div className="divide-y divide-border">
            {sessions.map((session) => {
              const Icon = clientIcon(session);
              return (
                <div key={session.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted-foreground">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{sessionLabel(session)}</p>
                      {session.current ? (
                        <Badge tone="success" className="gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          This device
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {session.client}
                      {session.appVersion ? ` · v${session.appVersion}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground" title={dateTime(session.lastActiveAt)}>
                      Last active {relativeTime(session.lastActiveAt)} · Signed in{' '}
                      {shortDate(session.createdAt)}
                    </p>
                  </div>
                  {session.current ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={pending}
                      onClick={() => setConfirm({ kind: 'one', session })}
                    >
                      Revoke session
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={confirm !== null} onOpenChange={(next) => (next ? undefined : setConfirm(null))}>
        <DialogContent className="max-w-md">
          {confirm?.kind === 'all' ? (
            <>
              <DialogHeader>
                <DialogTitle>Revoke all other sessions?</DialogTitle>
                <DialogDescription>
                  This signs out {others.length} other{' '}
                  {others.length === 1 ? 'device' : 'devices'}. Your current session stays active,
                  and this can&apos;t be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => revokeAll.mutate()} disabled={pending}>
                  {revokeAll.isPending ? (
                    <>
                      <Spinner className="h-3.5 w-3.5 text-current" /> Revoking…
                    </>
                  ) : (
                    'Revoke all'
                  )}
                </Button>
              </DialogFooter>
            </>
          ) : confirm?.kind === 'one' ? (
            <>
              <DialogHeader>
                <DialogTitle>Revoke this session?</DialogTitle>
                <DialogDescription>
                  {sessionLabel(confirm.session)} will be signed out immediately. This can&apos;t be
                  undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => revokeOne.mutate(confirm.session.id)}
                  disabled={pending}
                >
                  {revokeOne.isPending ? (
                    <>
                      <Spinner className="h-3.5 w-3.5 text-current" /> Revoking…
                    </>
                  ) : (
                    'Revoke'
                  )}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SessionsSkeleton() {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-8 w-44 rounded-lg" />
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
