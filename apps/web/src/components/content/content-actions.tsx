'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Pencil, Trash2 } from 'lucide-react';
import type { PublishedContentDTO } from '@influenceos/contracts';
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
} from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/errors';


/**
 * Edit caption / delete — the content detail page's own editing and
 * destructive actions, alongside ContentReviewBar's review-state actions and
 * ContentAssociationPanel's influencer/campaign linking. A Story has no
 * caption to fix a wrong link for (see storyMedia on SocialPlayableContent),
 * so its edit affordance covers caption only, same as everything else.
 */
export function ContentActions({
  content,
  onDeleted,
}: {
  content: PublishedContentDTO;
  /** Called after a delete instead of going back to Live Content (the viewer closes itself). */
  onDeleted?: () => void;
}) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
        <Pencil className="h-3.5 w-3.5" /> {t('editContent.edit')}
      </Button>
      <EditCaptionDialog content={content} open={editOpen} onOpenChange={setEditOpen} />

      <Button type="button" variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
        <Trash2 className="text-danger h-3.5 w-3.5" /> {tCommon('delete')}
      </Button>
      <DeleteContentDialog
        content={content}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={onDeleted}
      />
    </div>
  );
}

/** Fix a post's caption — from the detail page or the viewer's More menu. */
export function EditCaptionDialog({
  content,
  open,
  onOpenChange,
}: {
  content: PublishedContentDTO;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const [caption, setCaption] = React.useState(content.caption ?? '');

  React.useEffect(() => {
    if (open) setCaption(content.caption ?? '');
  }, [open, content.caption]);

  const save = useMutation({
    mutationFn: () => api.content.update(content.id, { caption: caption.trim() || null }),
    onSuccess: () => {
      toast.success(t('editContent.updateSuccess'));
      qc.invalidateQueries();
      router.refresh();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editContent.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('editContent.dialogDescription')}</DialogDescription>
        </DialogHeader>
        <Field label={t('editContent.captionLabel')}>
          <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} />
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner className="text-current" /> : <Check className="h-4 w-4" />}
            {save.isPending ? tCommon('saving') : tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirm, then delete a post. Without `onDeleted` it goes back to Live Content. */
export function DeleteContentDialog({
  content,
  open,
  onOpenChange,
  onDeleted,
}: {
  content: PublishedContentDTO;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const remove = useMutation({
    mutationFn: () => api.content.remove(content.id),
    onSuccess: () => {
      toast.success(t('editContent.deleteSuccess'));
      onOpenChange(false);
      qc.invalidateQueries();
      if (onDeleted) {
        onDeleted();
        router.refresh();
      } else {
        router.push('/content');
        router.refresh();
      }
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('editContent.deleteConfirmTitle')}
      description={t('editContent.deleteConfirmDescription')}
      confirmLabel={tCommon('delete')}
      loading={remove.isPending}
      onConfirm={() => remove.mutate()}
    />
  );
}
