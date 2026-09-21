'use client';

import { MessagesSquare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CommentThread } from '@/components/collaboration/comment-thread';

/** Internal team notes on a brand (Collaboration Layer) — the same Note model
 *  used everywhere else, scoped to `brandId`. Backend/DTO have supported this
 *  since the Operations Intelligence pass; this is its first web surface. */
export function BrandNotesCard({ brandId }: { brandId: string }) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessagesSquare className="size-5 text-muted-foreground" aria-hidden /> Notes
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CommentThread
          context={{ brandId }}
          cacheKey={`brand:${brandId}`}
          emptyTitle="No notes yet"
          emptyDescription="Internal notes about this brand — visible to your team only."
        />
      </CardContent>
    </Card>
  );
}
