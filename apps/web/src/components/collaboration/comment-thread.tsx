'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AtSign, FileText, MessageSquare, Paperclip, Pencil, Pin, PinOff, Reply, Send, Trash2, X } from 'lucide-react';
import type { CursorPage, NoteDTO } from '@influenceos/contracts';
import { api } from '@/lib/api-browser';
import { toBrowserUrl, uploadAttachment } from '@/lib/upload';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
import { useLocalizedFormat } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useApp } from '@/components/shell/app-context';
import { BidiText } from '@/components/common/bidi-text';
import { errorMessage } from '@/lib/errors';

/** Exactly one context field identifies the thread — mirrors NoteContext on the domain layer. */
export interface CommentContext {
  influencerId?: string;
  brandId?: string;
  publishedContentId?: string;
  campaignId?: string;
  deliverableId?: string;
  shipmentId?: string;
  inspirationItemId?: string;
  /** Mirrors noteCreateSchema's NOTE_CHANNELS — kept a literal union so create() below satisfies the request schema without a cast. */
  channel?: 'general' | 'logistics';
  // Indexable so this is structurally a valid query-string payload for api.notes.list().
  [key: string]: string | undefined;
}

interface Mention {
  id: string;
  name: string;
}

function useMentionDirectory() {
  return useQuery({ queryKey: ['team-directory'], queryFn: () => api.users.directory(), staleTime: 60_000 });
}

/** Detects a live "@partial-name" span right before the caret, for the mention popover. */
function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([\w.-]{0,40})$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[1]!.length - 1, query: match[1]! };
}

/** The one message composer, with its @mention picker — exported so surfaces
 *  that don't use the full `<CommentThread>` chat layout (e.g. the influencer
 *  profile's flat notes list) still get working mentions instead of a second,
 *  bespoke plain-textarea composer. */
export function Composer({
  onSubmit,
  pending,
  placeholder,
  autoFocus,
  onCancel,
}: {
  onSubmit: (body: string, mentionedUserIds: string[], files: File[]) => void;
  pending: boolean;
  placeholder: string;
  autoFocus?: boolean;
  onCancel?: () => void;
}) {
  const [body, setBody] = React.useState('');
  const [mentions, setMentions] = React.useState<Mention[]>([]);
  const [mentionQuery, setMentionQuery] = React.useState<{ start: number; query: string } | null>(null);
  const [files, setFiles] = React.useState<File[]>([]);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const directory = useMentionDirectory();
  const { user } = useApp();
  const t = useTranslations('collaboration');
  const tCommon = useTranslations('common');

  const filtered = React.useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    return (directory.data ?? [])
      .filter((m) => m.id !== user.id && m.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [directory.data, mentionQuery, user.id]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setBody(value);
    setMentionQuery(activeMentionQuery(value, e.target.selectionStart ?? value.length));
  }

  function pickMention(m: Mention) {
    if (!mentionQuery) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? body.length;
    const next = `${body.slice(0, mentionQuery.start)}@${m.name} ${body.slice(caret)}`;
    setBody(next);
    setMentions((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    setMentionQuery(null);
    requestAnimationFrame(() => el?.focus());
  }

  function submit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    const mentionedUserIds = mentions.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id);
    onSubmit(trimmed, mentionedUserIds, files);
    setBody('');
    setMentions([]);
    setMentionQuery(null);
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="space-y-1.5">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-xs">
              <FileText className="h-3 w-3 text-muted-foreground" />
              <span className="max-w-[10rem] truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label={t('composer.removeFile', { fileName: f.name })}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative flex gap-2">
        <Popover open={mentionQuery !== null && filtered.length > 0}>
          <PopoverAnchor asChild>
            <Textarea
              ref={textareaRef}
              value={body}
              onChange={handleChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
                if (e.key === 'Escape' && onCancel) onCancel();
              }}
              placeholder={placeholder}
              rows={2}
              autoFocus={autoFocus}
              className="text-sm"
            />
          </PopoverAnchor>
          <PopoverContent align="start" className="w-64 p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
            <p className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground">
              <AtSign className="h-3 w-3" /> {t('composer.mentionSomeone')}
            </p>
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => pickMention(m)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-muted"
              >
                <Avatar name={m.name} size="xs" />
                <BidiText>{m.name}</BidiText>
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && setFiles((prev) => [...prev, ...Array.from(e.target.files!)])}
        />
        <div className="flex flex-col justify-end gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            title={t('composer.attachFile')}
            onClick={() => fileInputRef.current?.click()}
            aria-label={t('composer.attachFile')}
          >
            <Paperclip className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon-sm" disabled={!body.trim() || pending} onClick={submit} aria-label={t('composer.send')}>
            <Send className="h-3.5 w-3.5" />
          </Button>
          {onCancel && (
            <Button type="button" size="icon-sm" variant="ghost" onClick={onCancel} aria-label={tCommon('cancel')}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Opens a file attached to a message. Deliberately fetches a fresh signed
 *  URL on click rather than embedding one in the note payload — the same
 *  on-demand pattern AttachmentsPanel already uses, since a cached signed
 *  URL would just expire before anyone gets around to clicking it. */
export function AttachmentChip({ id, fileName }: { id: string; fileName: string }) {
  const [pending, setPending] = React.useState(false);
  const t = useTranslations('collaboration');

  async function open() {
    setPending(true);
    try {
      const attachment = await api.files.get(id);
      window.open(toBrowserUrl(attachment.downloadUrl), '_blank', 'noreferrer');
    } catch (e) {
      toast.error(errorMessage(e, t('composer.couldNotOpenFile')));
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs text-foreground/80 hover:bg-surface-muted disabled:opacity-50"
    >
      <FileText className="h-3 w-3 text-muted-foreground" />
      <span className="max-w-[10rem] truncate">{fileName}</span>
    </button>
  );
}

function MessageRow({
  note,
  queryKey,
  isReply,
  onReply,
}: {
  note: NoteDTO;
  queryKey: unknown[];
  isReply: boolean;
  onReply?: () => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useApp();
  const [editing, setEditing] = React.useState(false);
  const t = useTranslations('collaboration');
  const tCommon = useTranslations('common');
  const { relativeTime } = useLocalizedFormat();

  function onError(e: unknown) {
    toast.error(errorMessage(e, tCommon('somethingWentWrong')));
  }
  function invalidate() {
    queryClient.invalidateQueries({ queryKey });
  }

  const togglePin = useMutation({
    mutationFn: () => api.notes.pin(note.id, !note.pinned),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.notes.remove(note.id),
    onSuccess: invalidate,
    onError,
  });
  const editBody = useMutation({
    mutationFn: (body: string) => api.notes.editBody(note.id, { body }),
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
    onError,
  });

  const canModify = note.authorId === user.id || user.role === 'ADMIN';
  const deleted = note.deleted;
  const authorName = note.authorName ?? tCommon('unknown');

  return (
    <div className={cn('flex items-start gap-2', isReply && 'ms-8')}>
      <Avatar name={authorName} size={isReply ? 'xs' : 'sm'} />
      <div
        className={cn(
          'min-w-0 flex-1 rounded-lg px-3 py-2 text-sm',
          note.pinned ? 'border border-brand/40 bg-brand-soft/40' : 'bg-surface-muted',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium">
            <BidiText>{authorName}</BidiText>
            {note.pinned && <Pin className="ms-1 inline h-3 w-3 text-brand" />}
          </p>
          <span className="text-xs text-muted-foreground">
            {relativeTime(note.createdAt)}
            {note.editedAt && !deleted && t('message.editedSuffix')}
          </span>
        </div>
        {editing ? (
          <EditBox
            initial={note.body}
            pending={editBody.isPending}
            onCancel={() => setEditing(false)}
            onSave={(body) => editBody.mutate(body)}
          />
        ) : (
          <p className={cn('whitespace-pre-wrap text-foreground/90', deleted && 'italic text-muted-foreground')}>{note.body}</p>
        )}
        {!deleted && note.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {note.attachments.map((a) => (
              <AttachmentChip key={a.id} id={a.id} fileName={a.fileName} />
            ))}
          </div>
        )}
        {!deleted && (
          <div className="mt-1 flex items-center gap-1">
            {onReply && (
              <Button type="button" variant="ghost" size="icon-sm" title={t('message.reply')} onClick={onReply}>
                <Reply className="h-3.5 w-3.5" />
              </Button>
            )}
            {!isReply && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={note.pinned ? t('message.unpin') : t('message.pin')}
                disabled={togglePin.isPending}
                onClick={() => togglePin.mutate()}
              >
                {note.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </Button>
            )}
            {canModify && (
              <>
                <Button type="button" variant="ghost" size="icon-sm" title={tCommon('edit')} onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title={tCommon('delete')}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  <Trash2 className="h-3.5 w-3.5 text-danger" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EditBox({ initial, pending, onCancel, onSave }: { initial: string; pending: boolean; onCancel: () => void; onSave: (body: string) => void }) {
  const [value, setValue] = React.useState(initial);
  const tCommon = useTranslations('common');
  return (
    <div className="mt-1 space-y-1">
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={2} className="text-sm" autoFocus />
      <div className="flex justify-end gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {tCommon('cancel')}
        </Button>
        <Button type="button" size="sm" disabled={!value.trim() || pending} onClick={() => onSave(value.trim())}>
          {tCommon('save')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The shared Collaboration Layer thread UI (Operations Intelligence pass) —
 * ONE comment/chat component reused for Content/Deliverable/Shipment/
 * Inspiration comments, the Campaign Discussion tab, and General Team Chat.
 * Never a second bespoke comment box per surface.
 */
export function CommentThread({
  context,
  cacheKey,
  conversationKey,
  emptyTitle,
  emptyDescription,
  composerPlaceholder,
}: {
  context: CommentContext;
  /** Unique per-thread cache key segment, e.g. `content:${id}` or `campaign-chat:${campaignId}`. */
  cacheKey: string;
  /** When set, this thread is marked read (for the unread badge) whenever it loads. */
  conversationKey?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  composerPlaceholder?: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = React.useMemo(() => ['comment-thread', cacheKey], [cacheKey]);
  const [replyTo, setReplyTo] = React.useState<string | null>(null);
  const markedRef = React.useRef<string | null>(null);
  const t = useTranslations('collaboration');
  const tCommon = useTranslations('common');
  const resolvedEmptyTitle = emptyTitle ?? t('thread.emptyTitle');
  const resolvedEmptyDescription = emptyDescription ?? t('thread.emptyDescription');
  const resolvedComposerPlaceholder = composerPlaceholder ?? t('thread.composerPlaceholder');

  const thread = useQuery({
    queryKey,
    queryFn: () => api.notes.list(context, { limit: 30 }),
  });

  React.useEffect(() => {
    if (!conversationKey || !thread.data || markedRef.current === conversationKey) return;
    markedRef.current = conversationKey;
    api.notes
      .markConversationRead(conversationKey)
      .then(() => queryClient.invalidateQueries({ queryKey: ['conversation-unread', conversationKey] }))
      .catch(() => {});
  }, [conversationKey, thread.data, queryClient]);

  function onError(e: unknown) {
    toast.error(errorMessage(e, t('thread.couldNotSendMessage')));
  }

  const post = useMutation({
    mutationFn: async (input: { body: string; mentionedUserIds: string[]; parentId?: string; files: File[] }) => {
      const note = await api.notes.create({ ...context, body: input.body, mentionedUserIds: input.mentionedUserIds, parentId: input.parentId });
      // The upload target needs the note's own id, so attachments can only
      // go up after the note exists — same two-phase signed flow used
      // everywhere else (uploadAttachment), never a bespoke chat-only path.
      // A file failing to attach shouldn't hide that the message itself
      // sent successfully, so failures here surface per-file, not as a
      // reason to roll back or block the message.
      for (const file of input.files) {
        try {
          await uploadAttachment(file, { noteId: note.id });
        } catch (e) {
          toast.error(
            t('composer.attachmentFailed', {
              fileName: file.name,
              error: errorMessage(e, t('composer.uploadFailed')),
            }),
          );
        }
      }
      return note;
    },
    onSuccess: () => {
      setReplyTo(null);
      queryClient.invalidateQueries({ queryKey });
    },
    onError,
  });

  const loadMore = useMutation({
    mutationFn: (cursor: string) => api.notes.list(context, { limit: 30, cursor }),
    onSuccess: (page: CursorPage<NoteDTO>) => {
      queryClient.setQueryData<CursorPage<NoteDTO> | undefined>(queryKey, (prev) =>
        prev ? { data: [...prev.data, ...page.data], nextCursor: page.nextCursor, hasMore: page.hasMore } : page,
      );
    },
    onError,
  });

  const messages = thread.data?.data ?? [];

  return (
    <div className="space-y-4">
      <Composer
        placeholder={resolvedComposerPlaceholder}
        pending={post.isPending}
        onSubmit={(body, mentionedUserIds, files) => post.mutate({ body, mentionedUserIds, files })}
      />

      {thread.isLoading ? null : messages.length === 0 ? (
        <EmptyState icon={MessageSquare} title={resolvedEmptyTitle} description={resolvedEmptyDescription} />
      ) : (
        <div className="space-y-3">
          {messages.map((note) => (
            <div key={note.id} className="space-y-2">
              <MessageRow note={note} queryKey={queryKey} isReply={false} onReply={() => setReplyTo(note.id)} />
              {note.replies?.map((reply) => (
                <MessageRow key={reply.id} note={reply} queryKey={queryKey} isReply />
              ))}
              {replyTo === note.id && (
                <div className="ms-8">
                  <Composer
                    placeholder={t('message.writeReplyPlaceholder')}
                    pending={post.isPending}
                    autoFocus
                    onCancel={() => setReplyTo(null)}
                    onSubmit={(body, mentionedUserIds, files) => post.mutate({ body, mentionedUserIds, files, parentId: note.id })}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {thread.data?.hasMore && thread.data.nextCursor && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" disabled={loadMore.isPending} onClick={() => loadMore.mutate(thread.data!.nextCursor!)}>
            {loadMore.isPending ? tCommon('loading') : t('thread.loadEarlierMessages')}
          </Button>
        </div>
      )}
    </div>
  );
}
