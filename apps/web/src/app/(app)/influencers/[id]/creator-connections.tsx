'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link2, Link2Off, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api-browser';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { errorMessage as apiErrorMessage } from '@/lib/errors';

const errorMessage = (e: unknown, fallback: string) => (apiErrorMessage(e, fallback));
const PLATFORMS = ['INSTAGRAM', 'TIKTOK'] as const;

/**
 * Creator-OAuth connections (INT-3). Lets a creator authorize us to read their
 * OWN post metrics — the only way Instagram/TikTok expose them. Inert until the
 * platform app passes review: "Connect" surfaces the honest "not configured"
 * message from the server rather than pretending.
 */
export function CreatorConnections({ influencerId }: { influencerId: string }) {
  const t = useTranslations('influencers');
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['creator-connections', influencerId],
    queryFn: () => api.influencers.creatorConnections(influencerId),
  });
  const connected = new Set((data ?? []).map((c) => c.platform));

  const start = useMutation({
    mutationFn: (platform: string) => api.influencers.startCreatorConnection(influencerId, platform.toLowerCase()),
    onSuccess: (res) => {
      if (typeof window !== 'undefined' && res.url) window.location.href = res.url;
    },
    onError: (e) => toast.error(apiErrorMessage(e, t('errors.generic'))),
  });
  const disconnect = useMutation({
    mutationFn: (platform: string) => api.influencers.disconnectCreator(influencerId, platform.toLowerCase()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['creator-connections', influencerId] });
      toast.success(t('detail.connections.disconnectedToast'));
    },
    onError: (e) => toast.error(apiErrorMessage(e, t('errors.generic'))),
  });

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold">{t('detail.connections.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('detail.connections.description')}</p>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {PLATFORMS.map((platform) => {
          const isConnected = connected.has(platform);
          return (
            <div key={platform} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
              <PlatformBadge platform={platform} size="sm" />
              {isConnected ? (
                <>
                  <Badge tone="success">{t('detail.connections.connected')}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => disconnect.mutate(platform)} disabled={disconnect.isPending}>
                    <Link2Off className="h-3.5 w-3.5" /> {t('detail.connections.disconnect')}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => start.mutate(platform)} disabled={start.isPending}>
                  <Link2 className="h-3.5 w-3.5" /> {t('detail.connections.connect')}
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
