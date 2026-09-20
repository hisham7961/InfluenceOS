'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ContentViewerStateDTO, PublishedContentDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';

const EMPTY_STATE: ContentViewerStateDTO = { firstSeenAt: null, lastOpenedAt: null, reviewedAt: null, savedForLaterAt: null };

/**
 * Single-item New/Seen/Reviewed/Review-Later state — the same
 * PATCH /content/:id/view-state calls ContentViewer uses, for callers that
 * show one piece of content on its own (the standalone content detail page)
 * rather than a navigable list. Marking seen never touches the shared
 * ActivityLog (personal triage, not an operational event).
 */
export function useContentReview(content: PublishedContentDTO) {
  const queryClient = useQueryClient();
  const [state, setState] = React.useState<ContentViewerStateDTO>(content.viewerState ?? EMPTY_STATE);

  React.useEffect(() => setState(content.viewerState ?? EMPTY_STATE), [content.id, content.viewerState]);

  const markSeen = React.useCallback(() => {
    if (state.firstSeenAt) return;
    const now = new Date().toISOString();
    setState((s) => ({ ...s, firstSeenAt: now, lastOpenedAt: now }));
    api.content.updateViewState(content.id, { seen: true }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.id, state.firstSeenAt]);

  const setReviewed = React.useCallback(
    async (reviewed: boolean) => {
      const now = new Date().toISOString();
      setState((s) => ({ ...s, reviewedAt: reviewed ? now : null }));
      await api.content.updateViewState(content.id, { reviewed });
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'content-feed' || q.queryKey[0] === 'content-summary' });
    },
    [content.id, queryClient],
  );

  const setReviewLater = React.useCallback(
    async (saved: boolean) => {
      const now = new Date().toISOString();
      setState((s) => ({ ...s, savedForLaterAt: saved ? now : null }));
      await api.content.updateViewState(content.id, { reviewLater: saved });
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'content-feed' || q.queryKey[0] === 'content-summary' });
    },
    [content.id, queryClient],
  );

  return { state, markSeen, setReviewed, setReviewLater };
}
