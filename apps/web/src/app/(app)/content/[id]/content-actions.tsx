'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Pencil, Trash2 } from 'lucide-react';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/**
 * Edit caption / delete — the content detail page's own editing and
 * destructive actions, alongside ContentReviewBar's review-state actions and
 * ContentAssociationPanel's influencer/campaign linking. A Story has no
 * caption to fix a wrong link for (see storyMedia on SocialPlayableContent),
 * so its edit affordance covers caption only, same as everything else.
 */
export function ContentActions({ content }: { content: PublishedContentDTO }) {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useTranslations('content');
  const tCommon = useTranslations('common');

  const [editOpen, setEditOpen] = React.useState(false);
  const [caption, setCaption] = React.useState(content.caption ?? '');
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  React.useEffect(() => {
    if (!editOpen) setCaption(content.caption ?? '');
  }, [editOpen, content.caption]);

  const save = useMutation({
    mutationFn: () => api.content.update(content.id, { caption: caption.trim() || null }),
    onSuccess: () => {
      toast.success(t('editContent.updateSuccess'));
      qc.invalidateQueries();
      router.refresh();
      setEditOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const remove = useMutation({
    mutationFn: () => api.content.remove(content.id),
    onSuccess: () => {
      toast.success(t('editContent.deleteSuccess'));
      router.push('/content');
      router.refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <div className="flex items-center gap-2">
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Pencil className="h-3.5 w-3.5" /> {t('editContent.edit')}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('editContent.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('editContent.dialogDescription')}</DialogDescription>
          </DialogHeader>
          <Field label={t('editContent.captionLabel')}>
            <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={save.isPending}>
              {tCommon('cancel')}
            </Button>
            <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Spinner className="text-current" /> : <Check className="h-4 w-4" />}
              {save.isPending ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button type="button" variant="outline" size="sm" onClick={() => setDeleteOpen(true)} disabled={remove.isPending}>
        <Trash2 className="h-3.5 w-3.5 text-danger" /> {tCommon('delete')}
      </Button>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('editContent.deleteConfirmTitle')}
        description={t('editContent.deleteConfirmDescription')}
        confirmLabel={tCommon('delete')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
