'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Bookmark, BookmarkCheck, Check, Undo2 } from 'lucide-react';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { useContentReview } from '@/components/content/use-content-review';
import { Button } from '@/components/ui/button';

/**
 * Marks this content Seen for the current user the moment the detail page
 * opens (item 5 — "opening the actual Content Viewer/detail" includes this
 * standalone page, not just the dialog), and exposes the same Mark
 * Reviewed / Review Later actions the dialog Viewer has. Refreshes the
 * server-rendered page after an explicit action so the New/Seen/Reviewed
 * badge in ContentDetails (a sibling server-fed component) stays in sync —
 * the dialog Viewer avoids this round trip by merging its own local state
 * before passing `content` down, which this standalone page's two separate
 * components don't share.
 */
export function ContentReviewBar({ content }: { content: PublishedContentDTO }) {
  const router = useRouter();
  const { state, markSeen, setReviewed, setReviewLater } = useContentReview(content);

  React.useEffect(() => {
    markSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.id]);

  const isReviewed = !!state.reviewedAt;
  const isSavedForLater = !!state.savedForLaterAt;

  async function toggleReviewed() {
    await setReviewed(!isReviewed);
    router.refresh();
  }

  async function toggleReviewLater() {
    await setReviewLater(!isSavedForLater);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant={isReviewed ? 'secondary' : 'outline'} size="sm" onClick={toggleReviewed}>
        {isReviewed ? <Undo2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
        {isReviewed ? 'Mark Unreviewed' : 'Mark Reviewed'}
      </Button>
      <Button type="button" variant={isSavedForLater ? 'secondary' : 'outline'} size="sm" onClick={toggleReviewLater}>
        {isSavedForLater ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
        {isSavedForLater ? 'Saved for later' : 'Review Later'}
      </Button>
    </div>
  );
}
