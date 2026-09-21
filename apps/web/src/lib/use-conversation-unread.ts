'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-browser';

/** Unread count for one Collaboration Layer conversation (`channel:general` or
 *  `campaign:{id}`) — polled, and invalidated immediately by CommentThread
 *  once it marks the same key read (see comment-thread.tsx). */
export function useConversationUnread(conversationKey: string): number {
  const { data } = useQuery({
    queryKey: ['conversation-unread', conversationKey],
    queryFn: () => api.notes.unreadCounts([conversationKey]),
    refetchInterval: 60_000,
  });
  return data?.find((c) => c.conversationKey === conversationKey)?.unreadCount ?? 0;
}
