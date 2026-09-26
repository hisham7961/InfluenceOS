'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-browser';
import { qk } from '@/lib/query-keys';

/**
 * Whether AI assistance is on (P3.2 / P3.5): the AI buttons only show when an
 * admin has switched it on and the feature is allowed. Cheap and shared, so
 * every button on a page reads the same answer.
 */
export function useAiStatus() {
  return useQuery({ queryKey: qk.aiStatus, queryFn: () => api.ai.status(), staleTime: 60_000 });
}
