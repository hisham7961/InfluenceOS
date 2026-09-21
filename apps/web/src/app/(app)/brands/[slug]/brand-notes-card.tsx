'use client';

import { useTranslations } from 'next-intl';
import { MessagesSquare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CommentThread } from '@/components/collaboration/comment-thread';

/** Internal team notes on a brand (Collaboration Layer) — the same Note model
 *  used everywhere else, scoped to `brandId`. Backend/DTO have supported this
 *  since the Operations Intelligence pass; this is its first web surface. */
export function BrandNotesCard({ brandId }: { brandId: string }) {
  const t = useTranslations('brands');
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessagesSquare className="size-5 text-muted-foreground" aria-hidden /> {t('notes.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CommentThread
          context={{ brandId }}
          cacheKey={`brand:${brandId}`}
          emptyTitle={t('notes.emptyTitle')}
          emptyDescription={t('notes.emptyDescription')}
        />
      </CardContent>
    </Card>
  );
}
