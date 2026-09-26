'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarDays, CheckCircle2, ExternalLink, FileText, Send } from 'lucide-react';
import type { CreatorPortalDTO, CreatorTaskDTO, DeliverableStatus } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { errorMessage } from '@/lib/errors';
import { enumLabel } from '@/lib/enum-labels';
import { useLocalizedFormat } from '@/lib/format';
import { cn } from '@/lib/cn';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { ServerTextBridge } from '@/components/common/server-text-bridge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { SafeImg } from '@/components/ui/safe-img';
import { CaptionCheckList } from '@/components/content/caption-check';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** What each state means for the creator, in their words. */
const STATUS: Record<DeliverableStatus, { key: string; tone: Tone }> = {
  PLANNED: { key: 'todo', tone: 'neutral' },
  SENT_TO_INFLUENCER: { key: 'todo', tone: 'neutral' },
  AWAITING_PUBLICATION: { key: 'readyToPost', tone: 'info' },
  IN_REVIEW: { key: 'inReview', tone: 'info' },
  CHANGES_REQUESTED: { key: 'changes', tone: 'warning' },
  APPROVED: { key: 'approved', tone: 'success' },
  PUBLISHED: { key: 'posted', tone: 'success' },
  VERIFIED: { key: 'posted', tone: 'success' },
  MISSED: { key: 'missed', tone: 'danger' },
  CANCELLED: { key: 'cancelled', tone: 'neutral' },
};

/**
 * The creator's page (P3.3): the brief, each task with its due date,
 * requirements and approved script, their drafts with our feedback, and
 * where to send a new draft or the live post link. Phone first.
 */
export function CreatorPortal({
  token,
  initial,
  locale,
}: {
  token: string;
  initial: CreatorPortalDTO;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('campaigns.creatorPortal');
  const f = useLocalizedFormat();
  const [portal, setPortal] = React.useState(initial);
  const c = portal.campaign;
  const other = locale === 'ar' ? 'en' : 'ar';

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:py-10">
      <ServerTextBridge />
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground text-sm">
            {t('hello', { name: portal.creatorName })}
          </p>
          <h1 className="break-words text-2xl font-bold">
            <BidiText>{c.name}</BidiText>
          </h1>
          <p className="text-muted-foreground text-sm">
            <BidiText>{c.brandName}</BidiText>
            {c.startDate || c.endDate ? (
              <>
                {' · '}
                <LtrText>
                  {[
                    c.startDate ? f.shortDate(c.startDate) : null,
                    c.endDate ? f.shortDate(c.endDate) : null,
                  ]
                    .filter(Boolean)
                    .join(' – ')}
                </LtrText>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {c.brandLogoUrl ? (
            <SafeImg
              src={c.brandLogoUrl}
              alt={c.brandName}
              className="h-10 w-auto max-w-[6rem] object-contain"
            />
          ) : null}
          <a href={`?lang=${other}`} className="text-brand text-xs hover:underline" lang={other}>
            {other === 'ar' ? 'العربية' : 'English'}
          </a>
        </div>
      </header>

      {c.brief ? (
        <section className="border-border bg-card rounded-2xl border p-4">
          <h2 className="mb-2 text-sm font-semibold">{t('brief')}</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed" dir="auto">
            {c.brief}
          </p>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('tasksTitle', { n: portal.tasks.length })}</h2>
        {portal.tasks.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noTasks')}</p>
        ) : null}
        {portal.tasks.map((task) => (
          <TaskCard
            key={task.id}
            token={token}
            task={task}
            draftReview={c.draftReview}
            onChange={setPortal}
          />
        ))}
      </section>

      <footer className="text-muted-foreground border-border border-t pt-4 text-center text-xs">
        {portal.expiresAt
          ? t('linkWorksUntil', { date: f.shortDate(portal.expiresAt) })
          : t('linkNoEnd')}
      </footer>
    </div>
  );
}

function TaskCard({
  token,
  task,
  draftReview,
  onChange,
}: {
  token: string;
  task: CreatorTaskDTO;
  draftReview: boolean;
  onChange: (p: CreatorPortalDTO) => void;
}) {
  const t = useTranslations('campaigns.creatorPortal');
  const tEnums = useTranslations('enums');
  const tCommon = useTranslations('common');
  const f = useLocalizedFormat();
  const status = STATUS[task.status];
  const waiting = task.drafts.some((d) => d.status === 'IN_REVIEW');
  const finished = !task.canSendPost;
  const overdue = !!task.dueDate && !finished && new Date(task.dueDate) < new Date();
  const title = `${enumLabel(tEnums, 'deliverableType', task.type)}${task.quantity > 1 ? ` × ${task.quantity}` : ''}`;

  return (
    <article className="border-border bg-card space-y-4 rounded-2xl border p-4" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PlatformBadge platform={task.platform} size="sm" />
          <h3 className="font-semibold">{title}</h3>
        </div>
        <Badge tone={status.tone}>{t(`status.${status.key}`)}</Badge>
      </div>

      {task.dueDate ? (
        <p
          className={cn(
            'flex items-center gap-1.5 text-sm',
            overdue ? 'text-danger font-medium' : 'text-muted-foreground',
          )}
        >
          <CalendarDays className="h-4 w-4" /> {t('due', { date: f.shortDate(task.dueDate) })}
          {overdue ? ` · ${t('overdue')}` : ''}
        </p>
      ) : null}

      {task.requirements || task.requiredHashtags.length || task.requiredMentions.length ? (
        <div className="space-y-1.5 text-sm">
          {task.requirements ? (
            <p className="whitespace-pre-wrap" dir="auto">
              {task.requirements}
            </p>
          ) : null}
          {task.requiredHashtags.length ? (
            <p>
              <span className="text-muted-foreground">{t('hashtags')}: </span>
              <LtrText>
                {task.requiredHashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
              </LtrText>
            </p>
          ) : null}
          {task.requiredMentions.length ? (
            <p>
              <span className="text-muted-foreground">{t('mentions')}: </span>
              <LtrText>
                {task.requiredMentions.map((m) => (m.startsWith('@') ? m : `@${m}`)).join(' ')}
              </LtrText>
            </p>
          ) : null}
        </div>
      ) : null}

      {task.script ? (
        <details className="border-border rounded-xl border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            <FileText className="me-1 inline h-4 w-4" /> {t('script', { title: task.script.title })}
          </summary>
          <div className="mt-3 space-y-3">
            {task.script.body ? (
              <p className="whitespace-pre-wrap leading-relaxed" dir="auto">
                {task.script.body}
              </p>
            ) : null}
            <ScriptList label={t('talkingPoints')} items={task.script.talkingPoints} />
            <ScriptList label={t('dos')} items={task.script.dos} />
            <ScriptList label={t('donts')} items={task.script.donts} />
            <ScriptList label={t('requiredClaims')} items={task.script.requiredClaims} />
            {task.script.captionSuggestion ? (
              <div>
                <p className="text-muted-foreground text-xs font-medium">
                  {t('captionSuggestion')}
                </p>
                <p className="whitespace-pre-wrap" dir="auto">
                  {task.script.captionSuggestion}
                </p>
              </div>
            ) : null}
            {task.script.hashtags.length || task.script.mentions.length ? (
              <p>
                <LtrText>{[...task.script.hashtags, ...task.script.mentions].join(' ')}</LtrText>
              </p>
            ) : null}
            {task.script.referenceLinks.length ? (
              <ul className="space-y-1">
                {task.script.referenceLinks.map((l) => (
                  <li key={l}>
                    <a
                      href={l}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand break-all hover:underline"
                      dir="ltr"
                    >
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </details>
      ) : null}

      {task.drafts.length ? (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">{t('yourDrafts')}</h4>
          <ul className="space-y-2">
            {task.drafts.map((d) => (
              <li key={d.id} className="border-border rounded-xl border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {t('draftVersion', { version: d.version })} ·{' '}
                    <span className="text-muted-foreground">{f.shortDate(d.createdAt)}</span>
                  </span>
                  <Badge
                    tone={
                      d.status === 'APPROVED'
                        ? 'success'
                        : d.status === 'IN_REVIEW'
                          ? 'info'
                          : d.status === 'CHANGES_REQUESTED' || d.status === 'REJECTED'
                            ? 'warning'
                            : 'neutral'
                    }
                  >
                    {enumLabel(tEnums, 'submissionStatus', d.status)}
                  </Badge>
                </div>
                {d.assetUrl ? (
                  <a
                    href={d.assetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand mt-1 inline-flex items-center gap-1 hover:underline"
                  >
                    {t('openDraft')} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
                {d.feedback ? (
                  <p className="bg-muted/60 mt-2 whitespace-pre-wrap rounded-lg p-2" dir="auto">
                    <span className="text-muted-foreground block text-xs font-medium">
                      {t('ourFeedback')}
                    </span>
                    {d.feedback}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {waiting ? (
        <p className="bg-info/10 text-info rounded-lg p-2 text-sm">{t('waitingForReview')}</p>
      ) : null}
      {task.status === 'APPROVED' ? (
        <p className="bg-success/10 text-success rounded-lg p-2 text-sm">{t('approvedGoPost')}</p>
      ) : null}

      {task.canSendDraft && (draftReview || task.type === 'UGC' || task.drafts.length > 0) ? (
        <DraftForm
          token={token}
          taskId={task.id}
          captionRules={task.captionRules}
          onChange={onChange}
          fallback={tCommon('somethingWentWrong')}
        />
      ) : null}

      {task.canSendPost && task.type !== 'UGC' ? (
        <PostForm
          token={token}
          task={task}
          onChange={onChange}
          fallback={tCommon('somethingWentWrong')}
        />
      ) : null}

      {finished && task.postUrl ? (
        <p className="text-success flex items-center gap-1.5 text-sm">
          <CheckCircle2 className="h-4 w-4" /> {t('postReceived')}
        </p>
      ) : null}
    </article>
  );
}

function ScriptList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <ul className="list-disc space-y-0.5 ps-5">
        {items.map((i) => (
          <li key={i} dir="auto">
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DraftForm({
  token,
  taskId,
  captionRules,
  onChange,
  fallback,
}: {
  token: string;
  taskId: string;
  captionRules: CreatorTaskDTO['captionRules'];
  onChange: (p: CreatorPortalDTO) => void;
  fallback: string;
}) {
  const t = useTranslations('campaigns.creatorPortal');
  const [assetUrl, setAssetUrl] = React.useState('');
  const [caption, setCaption] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      className="border-border space-y-3 rounded-xl border border-dashed p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          onChange(
            await api.creatorLinks.sendDraft(token, taskId, {
              assetUrl: assetUrl.trim(),
              caption: caption.trim() || null,
              notes: notes.trim() || null,
            }),
          );
          toast.success(t('draftSent'));
          setAssetUrl('');
          setCaption('');
          setNotes('');
        } catch (err) {
          toast.error(errorMessage(err, fallback));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h4 className="text-sm font-semibold">{t('sendDraftTitle')}</h4>
      <Field label={t('draftLink')} hint={t('draftLinkHint')}>
        <Input
          type="url"
          inputMode="url"
          required
          dir="ltr"
          placeholder="https://"
          aria-label={t('draftLink')}
          value={assetUrl}
          onChange={(e) => setAssetUrl(e.target.value)}
        />
      </Field>
      <Field label={t('caption')}>
        <Textarea
          rows={3}
          dir="auto"
          aria-label={t('caption')}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={2200}
        />
      </Field>
      <CaptionCheckList caption={caption} rules={captionRules} live />
      <Field label={t('note')}>
        <Textarea
          rows={2}
          dir="auto"
          aria-label={t('note')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={busy || !assetUrl.trim()}>
        <Send className="h-4 w-4 rtl:-scale-x-100" /> {t('sendDraft')}
      </Button>
    </form>
  );
}

function PostForm({
  token,
  task,
  onChange,
  fallback,
}: {
  token: string;
  task: CreatorTaskDTO;
  onChange: (p: CreatorPortalDTO) => void;
  fallback: string;
}) {
  const t = useTranslations('campaigns.creatorPortal');
  const f = useLocalizedFormat();
  const [url, setUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      className="border-border space-y-2 rounded-xl border p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          onChange(await api.creatorLinks.sendPost(token, task.id, { url: url.trim() }));
          toast.success(t('postSent'));
          setUrl('');
        } catch (err) {
          toast.error(errorMessage(err, fallback));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h4 className="text-sm font-semibold">
        {task.postUrl ? t('postSentTitle') : t('postTitle')}
      </h4>
      {task.postUrl ? (
        <p className="text-muted-foreground text-xs">
          <a
            href={task.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand break-all hover:underline"
            dir="ltr"
          >
            {task.postUrl}
          </a>
          {task.postedAt ? ` · ${f.shortDate(task.postedAt)}` : ''}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Input
          type="url"
          inputMode="url"
          required
          dir="ltr"
          placeholder="https://"
          aria-label={t('postLink')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={busy || !url.trim()}>
          {task.postUrl ? t('updatePost') : t('sendPost')}
        </Button>
      </div>
    </form>
  );
}
