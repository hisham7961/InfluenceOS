'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link2, Plus } from 'lucide-react';
import type { CampaignDetailDTO, CampaignInfluencerDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Pagination } from '@/components/ui/pagination';
import { ContentGrid } from '@/components/content/content-grid';
import { AddContentFlow } from '@/components/content/add-content-flow';
import { ReviewNewContentButton } from '@/components/content/review-new-content-button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/errors';

// ---------------------------------------------------------------------------
// Live Content — same PublishedContent records as the global Live Content
// page, filtered to this campaign (never a copy — see WORKFLOW_GAP_MATRIX.md).
// ---------------------------------------------------------------------------

const LIVE_CONTENT_PAGE_SIZE = 24;

export function LiveContentTab({
  campaign,
  influencers,
}: {
  campaign: CampaignDetailDTO;
  influencers: CampaignInfluencerDTO[];
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [linkedPage, setLinkedPage] = React.useState(1);
  const [unlinkedPage, setUnlinkedPage] = React.useState(1);

  const linkedQuery = useQuery({
    queryKey: ['campaign-content', campaign.id, 'linked', linkedPage],
    queryFn: () => api.campaigns.content(campaign.id, { bucket: 'linked', page: linkedPage, pageSize: LIVE_CONTENT_PAGE_SIZE }),
  });
  // This campaign's own roster influencers' content that isn't linked to it
  // yet — the gap the tab used to hide entirely (previously campaignId-only,
  // hard-capped at 20 with no pagination at all).
  const unlinkedQuery = useQuery({
    queryKey: ['campaign-content', campaign.id, 'unlinked', unlinkedPage],
    queryFn: () => api.campaigns.content(campaign.id, { bucket: 'unlinked', page: unlinkedPage, pageSize: LIVE_CONTENT_PAGE_SIZE }),
    enabled: influencers.length > 0,
  });

  const linked = linkedQuery.data;
  const unlinked = unlinkedQuery.data;
  const linkAll = useMutation({
    mutationFn: () => api.campaigns.linkRosterContent(campaign.id),
    onSuccess: (res) => {
      if (res.linked === 0) toast.message(t('workspace.liveContent.linkAllNone'));
      else toast.success(t('workspace.liveContent.linkAllDone', { count: res.linked }));
      queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const goToPage = (p: number) => t('workspace.liveContent.goToPage', { page: p });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ReviewNewContentButton campaignId={campaign.id} />
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> {t('workspace.liveContent.addContent')}
        </Button>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t('workspace.liveContent.linkedHeading', { count: linked?.pagination.total ?? 0 })}
        </h3>
        {linkedQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <ContentGrid items={linked?.data ?? []} emptyDescription={t('workspace.liveContent.emptyDescription')} />
            {linked ? (
              <Pagination
                page={linkedPage}
                totalPages={linked.pagination.totalPages}
                onPageChange={setLinkedPage}
                previousLabel={tCommon('previous')}
                nextLabel={tCommon('next')}
                pageAriaLabel={goToPage}
              />
            ) : null}
          </>
        )}
      </div>

      {influencers.length > 0 ? (
        <div className="space-y-3 border-t border-border pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t('workspace.liveContent.unlinkedHeading', { count: unlinked?.pagination.total ?? 0 })}
            </h3>
            {(unlinked?.pagination.total ?? 0) > 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={() => linkAll.mutate()} disabled={linkAll.isPending}>
                <Link2 className="h-3.5 w-3.5" />
                {linkAll.isPending ? tCommon('saving') : t('workspace.liveContent.linkAll')}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t('workspace.liveContent.linkAllHint')}</p>
          {unlinkedQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (unlinked?.data.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">{t('workspace.liveContent.unlinkedEmptyDescription')}</p>
          ) : (
            <>
              <ContentGrid items={unlinked!.data} />
              <Pagination
                page={unlinkedPage}
                totalPages={unlinked!.pagination.totalPages}
                onPageChange={setUnlinkedPage}
                previousLabel={tCommon('previous')}
                nextLabel={tCommon('next')}
                pageAriaLabel={goToPage}
              />
            </>
          )}
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workspace.liveContent.addDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('workspace.liveContent.addDialogDescription', { name: campaign.name })}
            </DialogDescription>
          </DialogHeader>
          <AddContentFlow
            lockCampaignId={campaign.id}
            lockCampaignName={campaign.name}
            rosterScope={influencers}
            onCancel={() => setOpen(false)}
            onSuccess={() => {
              queryClient.invalidateQueries();
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
