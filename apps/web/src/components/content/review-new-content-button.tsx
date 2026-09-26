'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { PartyPopper, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import { ContentViewer } from './content-viewer';

/**
 * The one "Review New Content" entry point (items 28, 40, 41) — Mission
 * Control's global CTA and a Brand's "Review N New <Brand> Videos" CTA both
 * render this SAME component with a different `brandId`, and it opens the
 * SAME ContentViewer in Review Mode. No second viewer, no second review flow.
 * Live Content and a campaign's Live Content tab use it too, narrowed by
 * `brandId` / `campaignId`.
 */
export function ReviewNewContentButton({
  brandId,
  campaignId,
  count,
  label,
}: {
  brandId?: string;
  campaignId?: string;
  /** New (never-opened) count for this scope, if already known — avoids a redundant fetch just to size the button label. */
  count?: number;
  label?: string;
}) {
  const t = useTranslations('content');
  const tCommon = useTranslations('common');
  const [open, setOpen] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const newContent = useQuery({
    queryKey: ['review-new-content', brandId, campaignId] as const,
    queryFn: () => api.content.feed({ reviewState: 'NEW', brandId, campaignId, limit: 50 }),
    enabled: false,
  });

  async function start() {
    const result = await newContent.refetch();
    const items = result.data?.data ?? [];
    if (items.length === 0) {
      toast.message(t('reviewMode.caughtUp'), { icon: <PartyPopper className="h-4 w-4" /> });
      return;
    }
    setIndex(0);
    setOpen(true);
  }

  const items = newContent.data?.data ?? [];
  const buttonLabel =
    label ?? (count != null ? t('reviewMode.reviewCountNewContent', { count }) : t('reviewMode.reviewNewContent'));

  if (count === 0) return null;

  return (
    <>
      <Button type="button" size="sm" onClick={start} disabled={newContent.isFetching}>
        <Sparkles className="h-3.5 w-3.5" /> {newContent.isFetching ? tCommon('loading') : buttonLabel}
      </Button>
      {items.length > 0 ? (
        <ContentViewer items={items} index={index} onIndexChange={setIndex} open={open} onOpenChange={setOpen} reviewMode />
      ) : null}
    </>
  );
}
