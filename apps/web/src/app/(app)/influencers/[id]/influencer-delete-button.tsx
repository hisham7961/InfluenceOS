'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import type { InfluencerDetailDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { errorMessage } from '@/lib/errors';


/**
 * "Delete influencer" — mirrors influencer.service.ts's remove(): a creator
 * with no campaign history is actually deleted (redirects back to the
 * directory), one with campaign history is deactivated instead (isActive:
 * false, preserving that history) and stays on this page, refreshed. The
 * confirm copy is deliberately neutral about which will happen — the
 * backend decides based on data the dialog can't know without an extra
 * round trip, and either outcome is confirmed by the toast that follows.
 */
export function InfluencerDeleteButton({ influencer }: { influencer: InfluencerDetailDTO }) {
  const router = useRouter();
  const t = useTranslations('influencers');
  const tc = useTranslations('common');
  const [open, setOpen] = React.useState(false);

  const remove = useMutation({
    mutationFn: () => api.influencers.remove(influencer.id),
    onSuccess: (res) => {
      toast.success(res.hardDeleted ? t('detail.delete.deletedToast') : t('detail.delete.deactivatedToast'));
      setOpen(false);
      if (res.hardDeleted) {
        router.push('/influencers');
      } else {
        router.refresh();
      }
    },
    onError: (e) => toast.error(errorMessage(e, t('errors.generic'))),
  });

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4 text-danger" /> {tc('delete')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('detail.delete.confirmTitle', { name: influencer.displayName })}
        description={t('detail.delete.confirmDescription')}
        confirmLabel={tc('delete')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
