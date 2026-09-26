'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react';
import type { DraftReviewDTO, ScriptDraftDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { useAiStatus } from '@/lib/ai-status';
import { useApp } from '@/components/shell/app-context';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { LtrText } from '@/components/common/bidi-text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

/**
 * AI writing help (P3.5): buttons that fill a form in for the team to edit.
 * Nothing here saves anything, and nothing shows unless an admin has turned
 * writing help on in Settings → AI.
 */

type Lang = 'en' | 'ar';

/** Writing help is on for the app. */
export function useWritingHelp(): boolean {
  return useAiStatus().data?.writingHelp === true;
}

function useUiLanguage(): Lang {
  return useLocale().startsWith('ar') ? 'ar' : 'en';
}

/** Mutation options shared by every writing helper: errors as toasts, the remaining count refreshed. */
function useAiMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  onSuccess: (r: TResult) => void,
) {
  const queryClient = useQueryClient();
  const tCommon = useTranslations('common');
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      onSuccess(r);
      queryClient.invalidateQueries({ queryKey: qk.aiStatus });
    },
    onError: (e) => {
      toast.error(errorMessage(e, tCommon('somethingWentWrong')));
      queryClient.invalidateQueries({ queryKey: qk.aiStatus });
    },
  });
}

function Remaining({ count }: { count: number | null }) {
  const t = useTranslations('campaigns.aiWriting');
  if (count == null) return null;
  return <span className="text-muted-foreground text-xs">{t('remaining', { count })}</span>;
}

/**
 * "Draft with AI" for a script version: a first draft from the campaign
 * brief (and the script's current text and deliverable, when there is one),
 * in the language picked, filled into the form below.
 */
export function AiScriptDraft({
  campaignId,
  scriptId,
  onDraft,
}: {
  campaignId: string;
  scriptId?: string;
  onDraft: (draft: ScriptDraftDTO) => void;
}) {
  const t = useTranslations('campaigns.aiWriting');
  const writingHelp = useWritingHelp();
  const { can } = useApp();
  const enabled = writingHelp && can('CAMPAIGNS_MANAGE');
  const uiLanguage = useUiLanguage();
  const [language, setLanguage] = React.useState<Lang>(uiLanguage);
  const [instructions, setInstructions] = React.useState('');
  const [remaining, setRemaining] = React.useState<number | null>(null);
  const draft = useAiMutation(
    () =>
      api.ai.draftScript(campaignId, {
        scriptId,
        language,
        instructions: instructions.trim() || undefined,
      }),
    (d) => {
      onDraft(d);
      setRemaining(d.remaining);
      toast.success(t('scriptDrafted'));
    },
  );
  if (!enabled) return null;

  return (
    <div className="border-brand/30 bg-brand-soft/30 space-y-2 rounded-lg border border-dashed p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="text-brand h-4 w-4" />{' '}
        {scriptId ? t('scriptNextTitle') : t('scriptTitle')}
      </p>
      <p className="text-muted-foreground text-xs">{t('scriptHint')}</p>
      <Input
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder={t('instructionsPlaceholder')}
        aria-label={t('instructionsLabel')}
        maxLength={2000}
        disabled={draft.isPending}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('languageLabel')}
          className="border-border bg-background h-8 rounded-md border px-2 text-xs"
          value={language}
          onChange={(e) => setLanguage(e.target.value as Lang)}
          disabled={draft.isPending}
        >
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={draft.isPending}
          onClick={() => draft.mutate(undefined)}
        >
          {draft.isPending ? (
            <Spinner className="text-current" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {draft.isPending ? t('writing') : t('scriptButton')}
        </Button>
        <Remaining count={remaining} />
      </div>
    </div>
  );
}

/**
 * "Suggest notes with AI" in the draft review: what the AI would tell the
 * creator, the caption check's findings, and one click to use the notes as
 * the review note (still editable, still the reviewer's decision).
 */
export function AiDraftReview({
  submissionId,
  onUse,
}: {
  submissionId: string;
  onUse: (note: string) => void;
}) {
  const t = useTranslations('campaigns.aiWriting');
  const writingHelp = useWritingHelp();
  const { can } = useApp();
  const enabled = writingHelp && can('UGC_REVIEW');
  const language = useUiLanguage();
  const [result, setResult] = React.useState<DraftReviewDTO | null>(null);
  React.useEffect(() => setResult(null), [submissionId]);
  const review = useAiMutation(() => api.ai.reviewDraft(submissionId, { language }), setResult);
  if (!enabled) return null;

  const missing = result
    ? [
        ...result.caption.missingHashtags,
        ...result.caption.missingMentions,
        ...(result.caption.disclosureMissing ? [t('adDisclosure')] : []),
      ]
    : [];

  return (
    <div className="border-brand/30 bg-brand-soft/30 space-y-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={review.isPending}
          onClick={() => review.mutate(undefined)}
        >
          {review.isPending ? (
            <Spinner className="text-current" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {review.isPending ? t('reviewing') : result ? t('reviewAgain') : t('reviewButton')}
        </Button>
        {result ? <Remaining count={result.remaining} /> : null}
      </div>
      {result ? (
        <div role="status" className="space-y-2 text-sm">
          <p className="flex items-start gap-1.5 font-medium">
            {result.looksReady ? (
              <CheckCircle2 className="text-success mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="text-warning mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span dir="auto">
              {result.summary || (result.looksReady ? t('looksReady') : t('needsChanges'))}
            </span>
          </p>
          {result.notes.length ? (
            <ul className="list-disc space-y-1 ps-5" dir="auto">
              {result.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          {missing.length ? (
            <p className="text-muted-foreground text-xs">
              {t('captionMissing')}{' '}
              {missing.map((m, i) => (
                <React.Fragment key={m}>
                  {i ? '، ' : null}
                  <LtrText>{m}</LtrText>
                </React.Fragment>
              ))}
            </p>
          ) : null}
          {result.notes.length ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onUse(result.notes.map((n) => `• ${n}`).join('\n'))}
            >
              {t('useNotes')}
            </Button>
          ) : null}
          <p className="text-muted-foreground text-xs">{t('reviewDisclaimer')}</p>
        </div>
      ) : null}
    </div>
  );
}

/** "Write with AI" for the client report's summary, from the report's own figures. */
export function AiReportSummaryButton({
  campaignId,
  onWritten,
}: {
  campaignId: string;
  onWritten: (summary: string) => void;
}) {
  const t = useTranslations('campaigns.aiWriting');
  const writingHelp = useWritingHelp();
  const { can } = useApp();
  const enabled = writingHelp && can('CAMPAIGNS_MANAGE');
  const language = useUiLanguage();
  const write = useAiMutation(
    () => api.ai.summarizeReport(campaignId, { language }),
    (r) => {
      onWritten(r.summary);
      toast.success(t('summaryWritten'));
    },
  );
  if (!enabled) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={write.isPending}
      onClick={() => write.mutate(undefined)}
    >
      {write.isPending ? (
        <Spinner className="text-current" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
      {write.isPending ? t('writing') : t('summaryButton')}
    </Button>
  );
}
