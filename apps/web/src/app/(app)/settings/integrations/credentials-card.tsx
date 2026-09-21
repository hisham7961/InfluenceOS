'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { KeyRound, Save, Trash2 } from 'lucide-react';
import type { ProviderCredentialStatusDTO, Tone } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { PlatformBadge } from '@/components/ui/platform-badge';

const SOURCE_TONE: Record<ProviderCredentialStatusDTO['source'], Tone> = {
  DB: 'success',
  ENV: 'info',
  NONE: 'neutral',
};

/**
 * INT-4 — admin card to store provider API keys, encrypted at rest. A stored key
 * overrides the same-named environment variable at runtime. Values are write-only:
 * the server returns a masked status (last 4 chars), never the secret.
 */
export function CredentialsCard({ initial }: { initial: ProviderCredentialStatusDTO[] }) {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const errorMessage = React.useCallback(
    (e: unknown) => (e instanceof ApiError ? e.message : t('integrations.errorGeneric')),
    [t],
  );
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['provider-credentials'],
    queryFn: () => api.integrations.credentials(),
    initialData: initial,
  });
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => api.integrations.setCredential({ key, value }),
    onSuccess: (rows, { key }) => {
      qc.setQueryData(['provider-credentials'], rows);
      setDrafts((d) => ({ ...d, [key]: '' }));
      toast.success(t('integrations.credentials.toastSaved'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (key: string) => api.integrations.removeCredential(key),
    onSuccess: (rows) => {
      qc.setQueryData(['provider-credentials'], rows);
      toast.success(t('integrations.credentials.toastRemoved'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rows = data ?? [];
  // Group by platform, preserving order.
  const groups = rows.reduce<Record<string, ProviderCredentialStatusDTO[]>>((acc, r) => {
    (acc[r.platform] ??= []).push(r);
    return acc;
  }, {});

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold">{t('integrations.credentials.heading')}</h3>
          <p className="text-xs text-muted-foreground">{t('integrations.credentials.description')}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {Object.entries(groups).map(([platform, keys]) => (
          <div key={platform} className="space-y-2">
            <div className="flex items-center gap-2">
              <PlatformBadge platform={platform as never} size="sm" />
            </div>
            <div className="space-y-2">
              {keys.map((row) => (
                <div key={row.key} className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-medium">{row.key}</p>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge tone={SOURCE_TONE[row.source]}>{t(`integrations.credentials.source.${row.source}`)}</Badge>
                      {row.last4 ? <span className="font-mono">{row.last4}</span> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      value={drafts[row.key] ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [row.key]: e.target.value }))}
                      placeholder={
                        row.isSet
                          ? t('integrations.credentials.placeholderReplace')
                          : t('integrations.credentials.placeholderEnter')
                      }
                      className="h-9 w-full sm:w-56"
                      aria-label={t('integrations.credentials.valueForAria', { key: row.key })}
                    />
                    <Button
                      size="sm"
                      disabled={!(drafts[row.key] ?? '').trim() || save.isPending}
                      onClick={() => save.mutate({ key: row.key, value: (drafts[row.key] ?? '').trim() })}
                    >
                      {save.isPending && save.variables?.key === row.key ? <Spinner className="text-current" /> : <Save className="h-3.5 w-3.5" />}
                      {tCommon('save')}
                    </Button>
                    {row.source === 'DB' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('integrations.credentials.removeAria', { key: row.key })}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(row.key)}
                        className="text-muted-foreground hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
