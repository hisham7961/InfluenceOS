'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Sparkles } from 'lucide-react';
import type { SuggestedCreatorDTO, SuggestionReasonDTO } from '@influenceos/contracts';
import { PLATFORM_META } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { errorMessage } from '@/lib/errors';
import { formatCompact } from '@/lib/format';
import { useCountryName } from '@/lib/country-names';
import { useApp } from '@/components/shell/app-context';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const FIRST = 4;

function useReasonLabel() {
  const t = useTranslations('campaigns.sourcing.suggestions.reasons');
  const country = useCountryName();
  return (r: SuggestionReasonDTO) => {
    switch (r.code) {
      case 'AUDIENCE_IN_MARKET':
        return r.countryCode
          ? t('audienceIn', { pct: r.pct ?? 0, country: country(r.countryCode) })
          : t('audienceInMarkets', { pct: r.pct ?? 0 });
      case 'BASED_IN_MARKET':
        return t('basedIn', { country: country(r.countryCode) });
      case 'WORKED_WITH_BRAND':
        return t('workedWithBrand', { count: r.campaigns ?? 1 });
      case 'HIGH_ENGAGEMENT':
        return t('engagement', { pct: r.pct ?? 0 });
      case 'PLATFORM_MATCH':
        return t('platform', { platform: r.platform ? PLATFORM_META[r.platform].label : '' });
    }
  };
}

/**
 * "Suggested for this campaign" (P3.7): creators not yet on the roster or the
 * sourcing list, ranked by plain rules, each with the reasons — and one click
 * to consider them (the match becomes their fit score).
 */
export function SuggestedCreators({ campaignId }: { campaignId: string }) {
  const t = useTranslations('campaigns.sourcing.suggestions');
  const tCommon = useTranslations('common');
  const country = useCountryName();
  const queryClient = useQueryClient();
  const { can } = useApp();
  const canAdd = can('CAMPAIGNS_MANAGE') || can('INFLUENCERS_MANAGE');
  const [showAll, setShowAll] = React.useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-candidates', campaignId, 'suggestions'],
    queryFn: () => api.campaigns.candidateSuggestions(campaignId, { limit: 12 }),
  });
  const add = useMutation({
    mutationFn: (s: SuggestedCreatorDTO) =>
      api.campaigns.addCandidate(campaignId, { influencerId: s.influencer.id, fitScore: s.score }),
    onSuccess: (_row, s) => {
      toast.success(t('addedToast', { name: s.influencer.displayName }));
      queryClient.invalidateQueries({ queryKey: ['campaign-candidates', campaignId] });
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });
  const reason = useReasonLabel();

  if (isError) return null;
  const list = data?.suggestions ?? [];
  const visible = showAll ? list : list.slice(0, FIRST);
  const basis =
    data && data.markets.length > 0
      ? t('basis', { countries: data.markets.map((c) => country(c)).join('، ') })
      : t('basisNoMarkets');

  return (
    <Card className="space-y-3 p-4" role="region" aria-label={t('title')}>
      <div className="flex items-start gap-2">
        <Sparkles className="text-brand mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">{t('title')}</h4>
          <p className="text-muted-foreground text-xs">{isLoading ? ' ' : basis}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <ul className="divide-border divide-y">
          {visible.map((s) => {
            const followers = s.influencer.totalFollowers;
            return (
              <li key={s.influencer.id} className="space-y-2 py-2.5">
                <div className="flex items-center gap-3">
                  <Link
                    href={`/influencers/${s.influencer.id}`}
                    className="flex min-w-0 flex-1 items-center gap-2.5 hover:underline"
                  >
                    <Avatar
                      name={s.influencer.displayName}
                      src={s.influencer.avatarUrl}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        <BidiText>{s.influencer.displayName}</BidiText>
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {s.influencer.primaryPlatform
                          ? PLATFORM_META[s.influencer.primaryPlatform].label
                          : null}
                        {followers != null ? (
                          <>
                            {s.influencer.primaryPlatform ? ' · ' : null}
                            <LtrText>{formatCompact(followers)}</LtrText>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="info" title={t('scoreHint')} className="whitespace-nowrap">
                      {t('score', { score: s.score })}
                    </Badge>
                    {canAdd ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => add.mutate(s)}
                        disabled={add.isPending}
                        aria-label={t('addAria', { name: s.influencer.displayName })}
                      >
                        <Plus className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('add')}</span>
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 ps-10" aria-label={t('whyLabel')}>
                  {s.reasons.map((r) => (
                    <Badge
                      key={r.code}
                      tone={r.code === 'WORKED_WITH_BRAND' ? 'success' : 'neutral'}
                      className="whitespace-nowrap"
                    >
                      {reason(r)}
                    </Badge>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {list.length > FIRST ? (
        <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? t('showFewer') : t('showAll', { count: list.length })}
        </Button>
      ) : null}
    </Card>
  );
}
