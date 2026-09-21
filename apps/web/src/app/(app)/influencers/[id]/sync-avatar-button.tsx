'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import type { InfluencerDetailDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/** "Sync profile photo" — re-resolves the creator's photo from their linked primary social account. */
export function SyncAvatarButton({ influencer }: { influencer: InfluencerDetailDTO }) {
  const router = useRouter();
  const t = useTranslations('influencers');
  const queryClient = useQueryClient();

  const sync = useMutation({
    mutationFn: () => api.influencers.syncAvatar(influencer.id),
    onSuccess: (res) => {
      toast[res.synced ? 'success' : 'info'](res.message);
      if (res.synced) {
        queryClient.invalidateQueries();
        router.refresh();
      }
    },
    onError: (e) => toast.error(errorMessage(e, t('errors.generic'))),
  });

  if (!influencer.primaryPlatform || !influencer.primaryUsername) return null;

  return (
    <Button variant="secondary" size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
      {sync.isPending ? <Spinner className="text-current" /> : <RefreshCw />}
      {t('detail.syncPhotoButton')}
    </Button>
  );
}
