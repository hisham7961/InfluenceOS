'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, ChevronDown, ChevronRight, FileText, Plus } from 'lucide-react';
import type { ScriptDTO, ScriptVersionDTO, ScriptVersionStatus } from '@influenceos/contracts';
import { SCRIPT_VERSION_STATUS_TONE } from '@influenceos/shared';
import { api } from '@/lib/api-browser';
import { enumLabel } from '@/lib/enum-labels';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Textarea } from '@/components/ui/input';
import { useLocalizedFormat } from '@/lib/format';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorMessage } from '@/lib/errors';
import { splitList } from './workspace-shared';

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

type TagTone = 'success' | 'danger' | 'info' | 'neutral' | 'accent';

function TagList({ label, items, tone, ltr = false }: { label: string; items: string[]; tone: TagTone; ltr?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <Badge key={`${item}-${i}`} tone={tone}>
            {/* #tag and @handle keep their sign in front in Arabic too. */}
            {ltr ? <LtrText>{item}</LtrText> : item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function ScriptsTab({ campaignId, scripts: serverScripts }: { campaignId: string; scripts: ScriptDTO[] }) {
  const t = useTranslations('campaigns');
  const tEnums = useTranslations('enums');
  const { relativeTime } = useLocalizedFormat();
  // A status move shows at once from the API's answer; the page refresh that
  // follows brings the server copy back in.
  const [updated, setUpdated] = React.useState<Record<string, ScriptDTO>>({});
  React.useEffect(() => setUpdated({}), [serverScripts]);
  const scripts = serverScripts.map((s) => updated[s.id] ?? s);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [newOpen, setNewOpen] = React.useState(false);
  const [addVersionFor, setAddVersionFor] = React.useState<ScriptDTO | null>(null);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t('workspace.scripts.countForCampaign', { count: scripts.length })}
        </p>
        <Button type="button" size="sm" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4" /> {t('workspace.scripts.newScript')}
        </Button>
      </div>

      {scripts.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t('workspace.scripts.emptyTitle')}
          description={t('workspace.scripts.emptyDescription')}
        />
      ) : (
        scripts.map((script) => {
          const current = script.versions.find((v) => v.version === script.currentVersion) ?? script.versions[0];
          const isOpen = expanded.has(script.id);

          return (
            <Card key={script.id} className="overflow-hidden">
              <div className="flex items-center gap-2 pe-3">
                <button
                  type="button"
                  onClick={() => toggle(script.id)}
                  className="flex flex-1 items-center justify-between gap-3 p-5 text-start transition-colors hover:bg-surface-muted"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                      <FileText className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        <BidiText>{script.title}</BidiText>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('workspace.scripts.versionUpdated', {
                          version: script.currentVersion,
                          relative: relativeTime(script.updatedAt),
                        })}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {current ? (
                          <Badge tone={SCRIPT_VERSION_STATUS_TONE[current.status]}>
                            {enumLabel(tEnums, 'scriptVersionStatus', current.status)}
                          </Badge>
                        ) : null}
                        {script.approvedVersion != null && script.approvedVersion !== current?.version ? (
                          <Badge tone="success">{t('workspace.scripts.approvedVersionChip', { version: script.approvedVersion })}</Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="rtl:-scale-x-100 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAddVersionFor(script)}>
                  <Plus className="h-3.5 w-3.5" /> {t('workspace.scripts.addVersion')}
                </Button>
              </div>

              {isOpen && current ? (
                <div className="space-y-4 border-t border-border p-5">
                <ScriptApprovalBar
                  script={script}
                  version={current}
                  onUpdated={(next) => setUpdated((prev) => ({ ...prev, [next.id]: next }))}
                />
                {current.body ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('workspace.scripts.scriptLabel')}
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{current.body}</p>
                  </div>
                ) : null}
                {current.captionSuggestion ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('workspace.scripts.captionSuggestionLabel')}
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{current.captionSuggestion}</p>
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <TagList label={t('workspace.scripts.dos')} items={current.dos} tone="success" />
                  <TagList label={t('workspace.scripts.donts')} items={current.donts} tone="danger" />
                  <TagList label={t('workspace.scripts.talkingPoints')} items={current.talkingPoints} tone="info" />
                  <TagList label={t('workspace.scripts.requiredClaims')} items={current.requiredClaims} tone="neutral" />
                  <TagList
                    label={t('workspace.scripts.hashtags')}
                    items={current.hashtags.map((h) => `#${h.replace(/^#+/, '')}`)}
                    tone="accent"
                    ltr
                  />
                  <TagList
                    label={t('workspace.scripts.mentions')}
                    items={current.mentions.map((m) => `@${m.replace(/^@+/, '')}`)}
                    tone="accent"
                    ltr
                  />
                </div>

                {current.referenceLinks.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('workspace.scripts.referenceLinks')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {current.referenceLinks.map((link) => (
                        <a
                          key={link}
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-brand hover:underline"
                        >
                          <LtrText>{link}</LtrText>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                {current.internalComments ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('workspace.scripts.internalCommentsLabel')}
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{current.internalComments}</p>
                  </div>
                ) : null}

                {current.createdByName ? (
                  <p className="text-xs text-muted-foreground">
                    {t('workspace.scripts.writtenBy', { name: current.createdByName })}
                  </p>
                ) : null}

                {script.versions.length > 1 ? (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('workspace.scripts.versionsLabel')}
                    </p>
                    <ul className="space-y-1.5">
                      {script.versions.map((v) => (
                        <li key={v.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="tabular-nums font-medium">v{v.version}</span>
                          <Badge tone={SCRIPT_VERSION_STATUS_TONE[v.status]}>
                            {enumLabel(tEnums, 'scriptVersionStatus', v.status)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{relativeTime(v.reviewedAt ?? v.createdAt)}</span>
                          {v.reviewNote ? (
                            <span className="w-full ps-7 text-xs text-muted-foreground">{v.reviewNote}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
              </Card>
            );
          })
      )}

      <NewScriptDialog campaignId={campaignId} open={newOpen} onOpenChange={setNewOpen} />
      <AddScriptVersionDialog
        script={addVersionFor}
        open={addVersionFor != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setAddVersionFor(null);
        }}
      />
    </div>
  );
}

/**
 * Where this version is with the brand, and the moves from there: sent to
 * the brand, the brand approved it (it becomes the version creators follow),
 * or the brand wants changes (with what they said).
 */
function ScriptApprovalBar({
  script,
  version,
  onUpdated,
}: {
  script: ScriptDTO;
  version: ScriptVersionDTO;
  onUpdated: (script: ScriptDTO) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tEnums = useTranslations('enums');
  const { relativeTime } = useLocalizedFormat();
  const queryClient = useQueryClient();
  const [changesOpen, setChangesOpen] = React.useState(false);
  const [note, setNote] = React.useState('');

  const move = useMutation({
    mutationFn: (body: { status: ScriptVersionStatus; note?: string }) =>
      api.scripts.setVersionStatus(script.id, version.version, body),
    onSuccess: (next) => {
      onUpdated(next);
      toast.success(t('workspace.scripts.statusUpdatedToast'));
      setChangesOpen(false);
      queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  const s = version.status;
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-muted/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('workspace.scripts.approvalLabel')}
        </span>
        <Badge tone={SCRIPT_VERSION_STATUS_TONE[s]}>{enumLabel(tEnums, 'scriptVersionStatus', s)}</Badge>
        {version.reviewedByName && version.reviewedAt ? (
          <span className="text-xs text-muted-foreground">
            <BidiText>{version.reviewedByName}</BidiText> · {relativeTime(version.reviewedAt)}
          </span>
        ) : null}
        <div className="ms-auto flex flex-wrap gap-1.5">
          {s === 'DRAFT' || s === 'CHANGES_REQUESTED' ? (
            <Button size="sm" variant="outline" disabled={move.isPending} onClick={() => move.mutate({ status: 'SENT_TO_BRAND' })}>
              {t('workspace.scripts.markSent')}
            </Button>
          ) : null}
          {s === 'SENT_TO_BRAND' ? (
            <Button size="sm" variant="ghost" disabled={move.isPending} onClick={() => move.mutate({ status: 'DRAFT' })}>
              {t('workspace.scripts.backToDraft')}
            </Button>
          ) : null}
          {s === 'SENT_TO_BRAND' || s === 'APPROVED' ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={move.isPending}
              onClick={() => {
                setNote('');
                setChangesOpen(true);
              }}
            >
              {t('workspace.scripts.markChanges')}
            </Button>
          ) : null}
          {s !== 'APPROVED' ? (
            <Button size="sm" disabled={move.isPending} onClick={() => move.mutate({ status: 'APPROVED' })}>
              <CheckCircle2 className="h-3.5 w-3.5" /> {t('workspace.scripts.markApproved')}
            </Button>
          ) : null}
        </div>
      </div>
      {version.reviewNote ? <p className="whitespace-pre-wrap text-sm text-foreground">{version.reviewNote}</p> : null}
      {s === 'APPROVED' ? (
        <p className="text-xs text-muted-foreground">{t('workspace.scripts.followThisVersion')}</p>
      ) : null}

      <Dialog open={changesOpen} onOpenChange={setChangesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workspace.scripts.changesDialogTitle')}</DialogTitle>
            <DialogDescription>{t('workspace.scripts.changesDialogDescription', { version: version.version })}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={t('workspace.scripts.changesNotePlaceholder')}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setChangesOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              disabled={move.isPending}
              onClick={() => move.mutate({ status: 'CHANGES_REQUESTED', note: note.trim() || undefined })}
            >
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Shared editable state for a single script version's main fields. */
function useScriptVersionFields() {
  const [body, setBody] = React.useState('');
  const [talkingPoints, setTalkingPoints] = React.useState('');
  const [dos, setDos] = React.useState('');
  const [donts, setDonts] = React.useState('');
  const [hashtags, setHashtags] = React.useState('');
  const [mentions, setMentions] = React.useState('');

  function reset() {
    setBody('');
    setTalkingPoints('');
    setDos('');
    setDonts('');
    setHashtags('');
    setMentions('');
  }

  function buildVersion() {
    return {
      body: body.trim() || null,
      talkingPoints: splitList(talkingPoints),
      dos: splitList(dos),
      donts: splitList(donts),
      hashtags: splitList(hashtags).map((h) => h.replace(/^#/, '')),
      mentions: splitList(mentions).map((m) => m.replace(/^@/, '')),
    };
  }

  return {
    body,
    setBody,
    talkingPoints,
    setTalkingPoints,
    dos,
    setDos,
    donts,
    setDonts,
    hashtags,
    setHashtags,
    mentions,
    setMentions,
    reset,
    buildVersion,
  };
}

function ScriptVersionFields({ fields }: { fields: ReturnType<typeof useScriptVersionFields> }) {
  const t = useTranslations('campaigns');
  const f = fields;
  return (
    <div className="space-y-4">
      <Field label={t('workspace.scripts.scriptBodyLabel')} hint={t('fields.optionalHint')}>
        <Textarea
          value={f.body}
          onChange={(e) => f.setBody(e.target.value)}
          rows={4}
          placeholder={t('workspace.scripts.scriptBodyPlaceholder')}
        />
      </Field>
      <Field label={t('workspace.scripts.talkingPoints')} hint={t('workspace.scripts.commaSeparatedHint')}>
        <Textarea
          value={f.talkingPoints}
          onChange={(e) => f.setTalkingPoints(e.target.value)}
          rows={2}
          placeholder={t('workspace.scripts.talkingPointsPlaceholder')}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('workspace.scripts.dos')} hint={t('workspace.scripts.commaSeparatedHint')}>
          <Textarea
            value={f.dos}
            onChange={(e) => f.setDos(e.target.value)}
            rows={2}
            placeholder={t('workspace.scripts.dosPlaceholder')}
          />
        </Field>
        <Field label={t('workspace.scripts.donts')} hint={t('workspace.scripts.commaSeparatedHint')}>
          <Textarea
            value={f.donts}
            onChange={(e) => f.setDonts(e.target.value)}
            rows={2}
            placeholder={t('workspace.scripts.dontsPlaceholder')}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('workspace.scripts.hashtags')} hint={t('workspace.scripts.commaSeparatedHint')}>
          <Input
            value={f.hashtags}
            onChange={(e) => f.setHashtags(e.target.value)}
            placeholder={t('workspace.scripts.hashtagsPlaceholder')}
          />
        </Field>
        <Field label={t('workspace.scripts.mentions')} hint={t('workspace.scripts.commaSeparatedHint')}>
          <Input
            value={f.mentions}
            onChange={(e) => f.setMentions(e.target.value)}
            placeholder={t('workspace.scripts.mentionsPlaceholder')}
          />
        </Field>
      </div>
    </div>
  );
}

function NewScriptDialog({
  campaignId,
  open,
  onOpenChange,
}: {
  campaignId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const [title, setTitle] = React.useState('');
  const fields = useScriptVersionFields();

  React.useEffect(() => {
    if (open) {
      setTitle('');
      fields.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const create = useMutation({
    mutationFn: () => {
      const trimmed = title.trim();
      if (!trimmed) throw new Error(t('workspace.scripts.enterTitleError'));
      return api.scripts.create({ campaignId, title: trimmed, ...fields.buildVersion() });
    },
    onSuccess: () => {
      toast.success(t('workspace.scripts.createdToast'));
      queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workspace.scripts.newScript')}</DialogTitle>
          <DialogDescription>{t('workspace.scripts.newScriptDialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t('fields.title')}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('workspace.scripts.titlePlaceholder')}
            />
          </Field>
          <ScriptVersionFields fields={fields} />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? t('workspace.scripts.creating') : t('workspace.scripts.createScript')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddScriptVersionDialog({
  script,
  open,
  onOpenChange,
}: {
  script: ScriptDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const fields = useScriptVersionFields();

  React.useEffect(() => {
    if (open) fields.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addVersion = useMutation({
    mutationFn: () => {
      if (!script) throw new Error(t('workspace.scripts.noScriptSelected'));
      return api.scripts.addVersion(script.id, fields.buildVersion());
    },
    onSuccess: () => {
      toast.success(t('workspace.scripts.versionAddedToast'));
      queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, tCommon('somethingWentWrong'))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workspace.scripts.addVersion')}</DialogTitle>
          <DialogDescription>
            {script
              ? t('workspace.scripts.addVersionDescriptionNamed', { title: script.title })
              : t('workspace.scripts.addVersionDescriptionGeneric')}
          </DialogDescription>
        </DialogHeader>

        <ScriptVersionFields fields={fields} />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={addVersion.isPending} onClick={() => addVersion.mutate()}>
            {addVersion.isPending ? t('workspace.scripts.addingVersion') : t('workspace.scripts.addVersion')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
