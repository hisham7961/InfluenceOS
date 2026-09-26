'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, Radar } from 'lucide-react';
import type { CampaignDetailDTO, CampaignInfluencerDTO, DiscoveredPostDTO } from '@influenceos/contracts';
import { PLATFORM_META } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { errorMessage } from '@/lib/errors';
import { enumLabel } from '@/lib/enum-labels';
import { useLocalizedFormat } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useApp } from '@/components/shell/app-context';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const NONE = '__none__';

/**
 * Posts found on the roster creators' own accounts (P3.4) that look like
 * this campaign's work, waiting for someone to add or dismiss them. Hidden
 * when there is nothing to decide; "Look for new posts" runs a check now.
 */
export function FoundPostsPanel({ campaign, influencers }: { campaign: CampaignDetailDTO; influencers: CampaignInfluencerDTO[] }) {
  const t = useTranslations('campaigns.foundPosts');
  const tCommon = useTranslations('common');
  const { can } = useApp();
  const queryClient = useQueryClient();
  const canManage = can('CONTENT_MANAGE');

  const found = useQuery({
    queryKey: qk.campaign.foundPosts(campaign.id),
    queryFn: () => api.discovery.forCampaign(campaign.id),
    enabled: influencers.length > 0,
  });

  const run = useMutation({
    mutationFn: () => api.discovery.runForCampaign(campaign.id),
    onSuccess: (r) => {
      if (r.found > 0) toast.success(t('runFound', { n: r.found }));
      else if (r.checked > 0) toast.message(t('runNothing', { n: r.checked }));
      else if (r.unavailable.length) toast.message(t('runUnavailable'));
      else if (r.recent > 0) toast.message(t('runRecent'));
      else toast.message(t('runNoAccounts'));
      void queryClient.invalidateQueries({ queryKey: qk.campaign.foundPosts(campaign.id) });
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const posts = found.data ?? [];
  if (!canManage && posts.length === 0) return null;

  return (
    <section className="border-border bg-card space-y-3 rounded-xl border p-4" aria-labelledby="found-posts-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="found-posts-heading" className="text-sm font-semibold">
            {t('title', { n: posts.length })}
          </h3>
          <p className="text-muted-foreground text-xs">{t('hint')}</p>
        </div>
        {canManage ? (
          <Button type="button" variant="outline" size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
            <Radar className="h-4 w-4" /> {t('lookNow')}
          </Button>
        ) : null}
      </div>
      {posts.length ? (
        <ul className="space-y-2">
          {posts.map((p) => (
            <FoundPostRow key={p.id} post={p} campaign={campaign} influencers={influencers} canManage={canManage} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function FoundPostRow({
  post,
  campaign,
  influencers,
  canManage,
}: {
  post: DiscoveredPostDTO;
  campaign: CampaignDetailDTO;
  influencers: CampaignInfluencerDTO[];
  canManage: boolean;
}) {
  const t = useTranslations('campaigns.foundPosts');
  const tEnums = useTranslations('enums');
  const tCommon = useTranslations('common');
  const f = useLocalizedFormat();
  const queryClient = useQueryClient();
  const row = influencers.find((ci) => ci.id === post.campaignInfluencerId);
  const options = (row?.deliverables ?? []).filter((d) => d.status !== 'CANCELLED');
  const [deliverableId, setDeliverableId] = React.useState<string>(post.deliverable?.id ?? NONE);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.campaign.foundPosts(campaign.id) });
    void queryClient.invalidateQueries({ queryKey: ['campaign-content', campaign.id] });
    void queryClient.invalidateQueries({ queryKey: qk.campaign.roster(campaign.id) });
  };
  const add = useMutation({
    mutationFn: () => api.discovery.add(post.id, { deliverableId: deliverableId === NONE ? null : deliverableId }),
    onSuccess: () => {
      toast.success(t('added'));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const dismiss = useMutation({
    mutationFn: () => api.discovery.dismiss(post.id),
    onSuccess: () => {
      toast.success(t('dismissed'));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <li className="border-border flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 gap-3">
        <Avatar name={post.influencer.displayName} src={post.influencer.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium">
              <BidiText>{post.influencer.displayName}</BidiText>
            </span>
            <PlatformBadge platform={post.platform} size="sm" />
            {post.postedAt ? <span className="text-muted-foreground text-xs">{f.relativeTime(post.postedAt)}</span> : null}
          </div>
          {post.caption ? (
            <p className="text-muted-foreground line-clamp-2 text-sm" dir="auto">
              {post.caption}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            {post.signals.map((s) => (
              <Badge key={s} tone="info">
                <Signal value={s} />
              </Badge>
            ))}
            <a href={post.url} target="_blank" rel="noopener noreferrer" className="text-brand inline-flex items-center gap-1 text-xs hover:underline">
              {t('open')} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
      {canManage ? (
        <div className="flex flex-col gap-2 sm:w-72">
          <Select value={deliverableId} onValueChange={setDeliverableId}>
            <SelectTrigger aria-label={t('deliverable')} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('noDeliverable')}</SelectItem>
              {options.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {enumLabel(tEnums, 'deliverableType', d.type)} · {PLATFORM_META[d.platform].label}
                  {d.dueDate ? ` · ${f.shortDate(d.dueDate)}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button type="button" size="sm" className="flex-1" onClick={() => add.mutate()} disabled={add.isPending || dismiss.isPending}>
              {t('add')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => dismiss.mutate()} disabled={add.isPending || dismiss.isPending}>
              {t('dismiss')}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** "code:SARA15" → "Code SARA15", "hashtag:#glow" → "#glow", "brand" → "Brand name"… */
function Signal({ value }: { value: string }) {
  const t = useTranslations('campaigns.foundPosts.signal');
  const [kind, rest] = value.includes(':') ? [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)] : [value, ''];
  if (kind === 'code')
    return (
      <>
        {t('code')} <LtrText>{rest}</LtrText>
      </>
    );
  if (kind === 'hashtag' || kind === 'mention') return <LtrText>{rest}</LtrText>;
  if (kind === 'brand') return <>{t('brand')}</>;
  if (kind === 'disclosure') return <>{t('disclosure')}</>;
  return <>{value}</>;
}
