'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Check, ShieldAlert, X } from 'lucide-react';
import type { CaptionRulesDTO } from '@influenceos/contracts';
import { SUGGESTED_DISCLOSURES, checkCaption } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { BidiText } from '@/components/common/bidi-text';
import { cn } from '@/lib/cn';

/**
 * Caption check (P3.5): the deliverable's hashtags and mentions, and the ad
 * disclosure, each ticked or crossed against a caption. Renders nothing
 * when the deliverable asks for nothing.
 */
export function CaptionCheckList({
  caption,
  rules,
  className,
  live = false,
}: {
  caption: string | null | undefined;
  rules: CaptionRulesDTO;
  className?: string;
  /** While someone is typing: softer wording, and nothing red until they've typed. */
  live?: boolean;
}) {
  const t = useTranslations('common.captionCheck');
  const check = checkCaption(caption, rules);
  if (check.empty) return null;
  const typed = !!caption?.trim();
  const missingTone = live && !typed ? 'text-muted-foreground' : 'text-danger';

  return (
    <div
      className={cn('border-border rounded-lg border p-3 text-sm', className)}
      role="group"
      aria-label={t('title')}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
          {t('title')}
        </span>
        {typed ? (
          <span className={cn('text-xs font-medium', check.ok ? 'text-success' : 'text-danger')}>
            {check.ok ? t('allGood') : t('somethingMissing')}
          </span>
        ) : null}
      </div>
      {check.disclosure.required ? (
        <p
          className={cn(
            'mb-2 flex items-start gap-1.5',
            check.disclosure.present ? 'text-success' : missingTone,
          )}
        >
          {check.disclosure.present ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>
            {check.disclosure.present ? (
              t('disclosurePresent')
            ) : (
              <>
                {t('disclosureMissing')}{' '}
                {SUGGESTED_DISCLOSURES.map((tag, i) => (
                  <React.Fragment key={tag}>
                    {i > 0 ? ' / ' : null}
                    <BidiText as="span" className="font-medium">
                      {tag}
                    </BidiText>
                  </React.Fragment>
                ))}
              </>
            )}
          </span>
        </p>
      ) : null}
      {check.hashtags.length || check.mentions.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('tagsLabel')}>
          {[
            ...check.hashtags.map((h) => ({ key: h.tag, present: h.present })),
            ...check.mentions.map((m) => ({ key: m.handle, present: m.present })),
          ].map((item) => (
            <li
              key={item.key}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                item.present
                  ? 'border-success/40 bg-success/10 text-success'
                  : live && !typed
                    ? 'border-border text-muted-foreground'
                    : 'border-danger/40 bg-danger/10 text-danger',
              )}
            >
              {item.present ? (
                <Check className="h-3 w-3" aria-hidden />
              ) : (
                <X className="h-3 w-3" aria-hidden />
              )}
              <BidiText as="span">{item.key}</BidiText>
              <span className="sr-only">{item.present ? t('present') : t('missing')}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The check for a deliverable's caption, fetching what the deliverable asks for. */
export function DeliverableCaptionCheck({
  deliverableId,
  caption,
  className,
}: {
  deliverableId: string;
  caption: string | null | undefined;
  className?: string;
}) {
  const rules = useQuery({
    queryKey: ['deliverable', deliverableId, 'caption-rules'],
    queryFn: () => api.deliverables.captionRules(deliverableId),
    staleTime: 60_000,
  });
  if (!rules.data) return null;
  return <CaptionCheckList caption={caption} rules={rules.data} className={className} />;
}
