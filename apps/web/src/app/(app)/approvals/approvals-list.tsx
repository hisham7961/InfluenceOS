'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ClipboardCheck, Paperclip } from 'lucide-react';
import type { ApprovalItemDTO } from '@influenceos/contracts';
import { appRoutes } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { useLocalizedFormat } from '@/lib/format';
import { BidiText } from '@/components/common/bidi-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SubmissionReviewDialog } from '../campaigns/[id]/submissions-tab';

/**
 * Approvals (P3.6): every draft waiting for review across campaigns, oldest
 * first, reviewed in place with the same dialog as the campaign's own queue.
 * Cards rather than a table, so it works one-handed on a phone.
 */
export function ApprovalsList() {
  const t = useTranslations('work.approvals');
  const [mine, setMine] = React.useState(false);
  const [reviewing, setReviewing] = React.useState<ApprovalItemDTO | null>(null);
  const query = useQuery({
    queryKey: ['approvals', { mine }],
    queryFn: () => api.work.approvals({ mine }),
  });
  const items = query.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5" role="group" aria-label={t('title')}>
        <Button
          size="sm"
          variant={mine ? 'ghost' : 'secondary'}
          aria-pressed={!mine}
          onClick={() => setMine(false)}
        >
          {t('all')}
        </Button>
        <Button
          size="sm"
          variant={mine ? 'secondary' : 'ghost'}
          aria-pressed={mine}
          onClick={() => setMine(true)}
        >
          {t('mine')}
        </Button>
      </div>

      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={mine ? t('emptyMine') : t('empty')}
          className="py-16"
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.submission.id}>
              <ApprovalCard item={item} onReview={() => setReviewing(item)} />
            </li>
          ))}
        </ul>
      )}

      <SubmissionReviewDialog
        submission={reviewing?.submission ?? null}
        creatorName={reviewing?.creator.name}
        deliverableType={reviewing?.deliverable.type}
        whatsapp={
          reviewing
            ? {
                influencerId: reviewing.creator.id,
                campaignInfluencerId: reviewing.campaignInfluencerId,
                campaignName: reviewing.campaign.name,
                brandName: reviewing.brandName,
                deliverables: [
                  { type: reviewing.deliverable.type, platform: reviewing.deliverable.platform },
                ],
              }
            : undefined
        }
        open={reviewing != null}
        onOpenChange={(open) => {
          if (!open) setReviewing(null);
        }}
      />
    </div>
  );
}

function ApprovalCard({ item, onReview }: { item: ApprovalItemDTO; onReview: () => void }) {
  const t = useTranslations('work.approvals');
  const tEnums = useTranslations('enums');
  const { shortDate, relativeTime } = useLocalizedFormat();
  const s = item.submission;
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Avatar name={item.creator.name} src={item.creator.avatarUrl} size="md" />
        <div className="min-w-0 space-y-1">
          <p className="truncate font-medium">
            <BidiText>{item.creator.name}</BidiText>
          </p>
          <p className="text-muted-foreground truncate text-sm">
            <Link
              href={appRoutes.campaign(item.campaign.id, 'submissions')}
              className="hover:underline"
            >
              <BidiText>{item.campaign.name}</BidiText>
            </Link>
            {' · '}
            <BidiText>{item.brandName}</BidiText>
          </p>
          <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
            <PlatformBadge platform={item.deliverable.platform} size="sm" />
            <span>{enumLabel(tEnums, 'deliverableType', item.deliverable.type)}</span>
            <span>· {t('version', { version: s.version })}</span>
            {s.attachment ? <Paperclip className="h-3 w-3" aria-hidden /> : null}
            <span>
              ·{' '}
              {s.fromCreator
                ? t('fromCreator')
                : s.submittedByName
                  ? t('submittedBy', { name: s.submittedByName })
                  : null}
            </span>
            <span>· {t('waiting', { time: relativeTime(s.createdAt) })}</span>
            {item.deliverable.dueDate ? (
              <span>· {t('due', { date: shortDate(item.deliverable.dueDate) })}</span>
            ) : null}
          </p>
          {s.caption ? (
            <p className="line-clamp-2 text-sm" dir="auto">
              {s.caption}
            </p>
          ) : null}
        </div>
      </div>
      <Button className="w-full sm:w-auto" onClick={onReview}>
        {t('review')}
      </Button>
    </Card>
  );
}
