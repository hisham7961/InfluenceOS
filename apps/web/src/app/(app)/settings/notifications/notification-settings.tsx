'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarClock, Mail, MailWarning, Send } from 'lucide-react';
import type {
  DigestDTO,
  DigestFrequency,
  DigestSectionDTO,
  NotificationCategory,
} from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { errorMessage } from '@/lib/errors';
import { enumLabel } from '@/lib/enum-labels';
import { formatCurrency, useLocalizedFormat } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { cn } from '@/lib/cn';

const SETTINGS_KEY = ['notifications', 'settings'] as const;
const PREVIEW_KEY = ['notifications', 'digest-preview'] as const;

/** Kinds offered for "email me right away", most urgent first. */
const EMAIL_CATEGORIES: NotificationCategory[] = [
  'CONTENT_REMOVED',
  'CONTENT_UNAVAILABLE',
  'MENTION',
  'REPLY',
  'IMPORTANT_MESSAGE',
  'DELIVERABLE_OVERDUE',
  'DELIVERABLE_DUE_SOON',
  'SUBMISSION_APPROVED',
  'USAGE_RIGHT_EXPIRING',
  'LICENCE_EXPIRING',
  'CAMPAIGN_ENDING',
  'LOGISTICS_ADDRESS_ISSUE',
  'SHIPMENT_DELIVERED',
  'SYNC_FAILURE',
  'NEW_CONTENT',
  'FOLLOWER_MILESTONE',
  'GENERAL',
];

const FREQUENCIES: DigestFrequency[] = ['DAILY', 'WEEKLY', 'OFF'];

/**
 * Settings → Notifications (P2.6): the summary email (every morning, Sunday
 * mornings, or off), which notifications also arrive by email as they
 * happen, a preview of what the summary holds right now, and a test email.
 */
export function NotificationSettings() {
  const t = useTranslations('settings.notifications');
  const tCat = useTranslations('notifications.categories');
  const qc = useQueryClient();
  const { dateTime } = useLocalizedFormat();

  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api.notifications.settings(),
  });
  const preview = useQuery({
    queryKey: PREVIEW_KEY,
    queryFn: () => api.notifications.digestPreview(),
  });

  const save = useMutation({
    mutationFn: (body: {
      digestFrequency?: DigestFrequency;
      emailCategories?: NotificationCategory[];
    }) => api.notifications.updateSettings(body),
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS_KEY, data);
      toast.success(t('saved'));
    },
    onError: (e) => toast.error(errorMessage(e, t('saveFailed'))),
  });

  const test = useMutation({
    mutationFn: () => api.notifications.sendTestEmail(),
    onSuccess: (r) => toast.success(t('testSent', { email: r.sentTo })),
    onError: (e) => toast.error(errorMessage(e, t('testFailed'))),
  });

  if (settings.isLoading || !settings.data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  const s = settings.data;
  const chosen = new Set(s.emailCategories);
  const toggle = (c: NotificationCategory, on: boolean) => {
    const next = EMAIL_CATEGORIES.filter((x) => (x === c ? on : chosen.has(x)));
    save.mutate({ emailCategories: next });
  };

  return (
    <div className="space-y-6">
      {!s.emailConfigured ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <MailWarning className="text-warning mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">{t('notConfiguredTitle')}</p>
              <p className="text-muted-foreground">{t('notConfiguredBody')}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="text-muted-foreground h-4 w-4" />
            {t('summaryTitle')}
          </CardTitle>
          <p className="text-muted-foreground text-sm">{t('summaryDescription')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="radiogroup"
            aria-label={t('summaryTitle')}
            className="grid gap-2 sm:grid-cols-3"
          >
            {FREQUENCIES.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={s.digestFrequency === f}
                disabled={save.isPending}
                onClick={() => s.digestFrequency !== f && save.mutate({ digestFrequency: f })}
                className={cn(
                  'rounded-xl border p-3 text-start text-sm transition-colors',
                  s.digestFrequency === f
                    ? 'border-brand bg-brand-soft'
                    : 'border-border hover:bg-surface-muted',
                )}
              >
                <span className="block font-medium">{t(`frequency.${f}`)}</span>
                <span className="text-muted-foreground block text-xs">
                  {t(`frequencyHint.${f}`)}
                </span>
              </button>
            ))}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              <LtrText>{s.email}</LtrText>
            </span>
            {s.lastDigestAt ? (
              <span>{t('lastSent', { when: dateTime(s.lastDigestAt) })}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!s.emailConfigured || test.isPending}
              onClick={() => test.mutate()}
              className="gap-1.5"
            >
              <Send className="h-3.5 w-3.5 rtl:-scale-x-100" />
              {t('sendTest')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <DigestPreview digest={preview.data} loading={preview.isLoading} />

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">{t('instantTitle')}</CardTitle>
          <p className="text-muted-foreground text-sm">{t('instantDescription')}</p>
        </CardHeader>
        <CardContent className="divide-border divide-y p-0">
          {EMAIL_CATEGORIES.map((c) => (
            <label
              key={c}
              className="flex cursor-pointer items-center justify-between gap-4 px-5 py-3 text-sm"
            >
              <span>{tCat(c)}</span>
              <Switch
                checked={chosen.has(c)}
                disabled={save.isPending}
                onCheckedChange={(on) => toggle(c, on)}
                aria-label={tCat(c)}
              />
            </label>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function DigestPreview({ digest, loading }: { digest: DigestDTO | undefined; loading: boolean }) {
  const t = useTranslations('settings.notifications');
  const tEnums = useTranslations('enums');
  const { shortDate } = useLocalizedFormat();

  const sections: {
    key: string;
    data: DigestSectionDTO;
    kind: 'deliverableType' | 'contentStatus' | 'usageRightType';
  }[] = digest
    ? [
        { key: 'overdue', data: digest.overdue, kind: 'deliverableType' },
        { key: 'dueSoon', data: digest.dueSoon, kind: 'deliverableType' },
        { key: 'reviews', data: digest.reviews, kind: 'deliverableType' },
        { key: 'removed', data: digest.removed, kind: 'contentStatus' },
        { key: 'expiring', data: digest.expiringRights, kind: 'usageRightType' },
      ]
    : [];

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {t('previewTitle')}
          {digest ? (
            <Badge tone="neutral">{digest.onlyMine ? t('previewMine') : t('previewTeam')}</Badge>
          ) : null}
        </CardTitle>
        <p className="text-muted-foreground text-sm">{t('previewDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !digest ? (
          <Skeleton className="h-24 w-full" />
        ) : digest.isEmpty ? (
          <p className="text-muted-foreground text-sm">{t('previewEmpty')}</p>
        ) : (
          sections
            .filter((s) => s.data.total > 0)
            .map((s) => (
              <div key={s.key} className="space-y-1.5">
                <p className="text-sm font-medium">
                  {t(`sections.${s.key}`)}{' '}
                  <span className="text-muted-foreground">({s.data.total})</span>
                </p>
                <ul className="space-y-1 text-sm">
                  {s.data.items.map((item) => (
                    <li key={item.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <Link
                        href={item.link}
                        className="min-w-0 truncate font-medium hover:underline"
                      >
                        <BidiText as="span">
                          {item.influencerName ?? item.brandName ?? '—'}
                        </BidiText>
                        {item.kind ? ` · ${enumLabel(tEnums, s.kind, item.kind)}` : ''}
                      </Link>
                      <span className="text-muted-foreground text-xs">
                        {item.campaignName ? (
                          <BidiText as="span">{item.campaignName}</BidiText>
                        ) : null}
                        {item.campaignName && item.at ? ' — ' : ''}
                        {item.at ? shortDate(item.at) : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                {s.data.total > s.data.items.length ? (
                  <p className="text-muted-foreground text-xs">
                    {t('andMore', { count: s.data.total - s.data.items.length })}
                  </p>
                ) : null}
              </div>
            ))
        )}
        {digest?.unpaid ? (
          <p className="border-border border-t pt-3 text-sm">
            <Link href="/finance" className="hover:underline">
              {t('unpaid', { count: digest.unpaid.count })}{' '}
              <LtrText>
                {digest.unpaid.totals
                  .map((x) => formatCurrency(Number(x.amount), x.currency))
                  .join(' + ')}
              </LtrText>
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
