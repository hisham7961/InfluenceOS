'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Sparkles } from 'lucide-react';
import type { MetricsReadDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { useAiStatus } from '@/lib/ai-status';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * "Read the numbers" (P3.2): Claude reads a post's attached insights
 * screenshot and the metrics form is filled in for a person to check and
 * save — nothing is saved here. Only shown when an admin has turned
 * screenshot reading on.
 */
export function ReadMetricsScreenshot({
  contentId,
  onRead,
}: {
  contentId: string;
  onRead: (result: MetricsReadDTO) => void;
}) {
  const t = useTranslations('content.metricsEntry.ai');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const ai = useAiStatus();
  const enabled = ai.data?.readScreenshots === true;
  // Same key as the attachments panel above it, so an upload shows up here too.
  const files = useQuery({
    queryKey: ['attachments', { publishedContentId: contentId }],
    queryFn: () => api.files.list({ publishedContentId: contentId }),
    enabled,
  });
  const images = (files.data ?? []).filter((f) => f.isImage);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<MetricsReadDTO | null>(null);
  const attachmentId = picked && images.some((i) => i.id === picked) ? picked : images[0]?.id;

  const read = useMutation({
    mutationFn: () =>
      api.content.readMetricsScreenshot(contentId, {
        attachmentId: attachmentId!,
        locale: locale.startsWith('ar') ? 'ar' : 'en',
      }),
    onSuccess: (res) => {
      setResult(res);
      onRead(res);
      queryClient.invalidateQueries({ queryKey: qk.aiStatus });
    },
    onError: (e) => {
      toast.error(errorMessage(e, tCommon('somethingWentWrong')));
      queryClient.invalidateQueries({ queryKey: qk.aiStatus });
    },
  });

  if (!enabled) return null;
  if (!files.isLoading && images.length === 0) {
    return <p className="text-muted-foreground mt-2 text-xs">{t('attachFirst')}</p>;
  }
  const filled = result ? Object.values(result.values).filter((v) => v != null).length : 0;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {images.length > 1 ? (
          <select
            aria-label={t('pick')}
            className="border-border bg-background h-8 max-w-[14rem] truncate rounded-md border px-2 text-xs"
            value={attachmentId}
            onChange={(e) => setPicked(e.target.value)}
            disabled={read.isPending}
          >
            {images.map((i) => (
              <option key={i.id} value={i.id}>
                {i.fileName}
              </option>
            ))}
          </select>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!attachmentId || read.isPending}
          onClick={() => read.mutate()}
        >
          {read.isPending ? (
            <Spinner className="text-current" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {read.isPending ? t('reading') : t('read')}
        </Button>
      </div>
      {result ? (
        <div role="status" className="bg-surface-muted space-y-1 rounded-lg p-2.5 text-xs">
          {result.looksLikeInsights ? (
            <p className="font-medium">{t('filled', { count: filled })}</p>
          ) : (
            <p className="text-warning flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {t('notInsights')}
            </p>
          )}
          {result.capturedOn ? <p className="text-muted-foreground">{t('dateFromShot')}</p> : null}
          {result.note ? <p className="text-muted-foreground">{result.note}</p> : null}
          {result.remaining != null ? (
            <p className="text-muted-foreground">{t('remaining', { count: result.remaining })}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
