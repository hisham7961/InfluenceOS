'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AtSign, MessageSquare, Pencil, Pin, PinOff, Reply, Send, Trash2, X } from 'lucide-react';
import type { CursorPage, NoteDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useApp } from '@/components/shell/app-context';

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
  onSubmit: (body: string, mentionedUserIds: string[]) => void;
  pending: boolean;
  placeholder: string;
  autoFocus?: boolean;
  onCancel?: () => void;
}) {
  const [body, setBody] = React.useState('');
  const [mentions, setMentions] = React.useState<Mention[]>([]);
  const [mentionQuery, setMentionQuery] = React.useState<{ start: number; query: string } | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const directory = useMentionDirectory();
  const { user } = useApp();

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
    onSubmit(trimmed, mentionedUserIds);
    setBody('');
    setMentions([]);
    setMentionQuery(null);
  }

  return (
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
            <AtSign className="h-3 w-3" /> Mention someone
          </p>
          {filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => pickMention(m)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
            >
              <Avatar name={m.name} size="xs" />
              {m.name}
            </button>
          ))}
        </PopoverContent>
      </Popover>
      <div className="flex flex-col justify-end gap-1">
        <Button type="button" size="icon-sm" disabled={!body.trim() || pending} onClick={submit} aria-label="Send">
          <Send className="h-3.5 w-3.5" />
        </Button>
        {onCancel && (
          <Button type="button" size="icon-sm" variant="ghost" onClick={onCancel} aria-label="Cancel">
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
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

  function onError(e: unknown) {
    toast.error(e instanceof ApiError ? e.message : 'Something went wrong.');
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

  return (
    <div className={cn('flex items-start gap-2', isReply && 'ms-8')}>
      <Avatar name={note.authorName ?? 'Unknown'} size={isReply ? 'xs' : 'sm'} />
      <div
        className={cn(
          'min-w-0 flex-1 rounded-lg px-3 py-2 text-sm',
          note.pinned ? 'border border-brand/40 bg-brand-soft/40' : 'bg-surface-muted',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium">
            {note.authorName ?? 'Unknown'}
            {note.pinned && <Pin className="ms-1 inline h-3 w-3 text-brand" />}
          </p>
          <span className="text-xs text-muted-foreground">
            {relativeTime(note.createdAt)}
            {note.editedAt && !deleted && ' · edited'}
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
        {!deleted && (
          <div className="mt-1 flex items-center gap-1">
            {onReply && (
              <Button type="button" variant="ghost" size="icon-sm" title="Reply" onClick={onReply}>
                <Reply className="h-3.5 w-3.5" />
              </Button>
            )}
            {!isReply && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={note.pinned ? 'Unpin' : 'Pin'}
                disabled={togglePin.isPending}
                onClick={() => togglePin.mutate()}
              >
                {note.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </Button>
            )}
            {canModify && (
              <>
                <Button type="button" variant="ghost" size="icon-sm" title="Edit" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Delete"
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
  return (
    <div className="mt-1 space-y-1">
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={2} className="text-sm" autoFocus />
      <div className="flex justify-end gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!value.trim() || pending} onClick={() => onSave(value.trim())}>
          Save
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
  emptyTitle = 'No messages yet',
  emptyDescription = 'Start the conversation below.',
  composerPlaceholder = 'Write a message… use @ to mention someone',
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
    toast.error(e instanceof ApiError ? e.message : 'Could not send the message.');
  }

  const post = useMutation({
    mutationFn: (input: { body: string; mentionedUserIds: string[]; parentId?: string }) =>
      api.notes.create({ ...context, body: input.body, mentionedUserIds: input.mentionedUserIds, parentId: input.parentId }),
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
        placeholder={composerPlaceholder}
        pending={post.isPending}
        onSubmit={(body, mentionedUserIds) => post.mutate({ body, mentionedUserIds })}
      />

      {thread.isLoading ? null : messages.length === 0 ? (
        <EmptyState icon={MessageSquare} title={emptyTitle} description={emptyDescription} />
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
                    placeholder="Write a reply…"
                    pending={post.isPending}
                    autoFocus
                    onCancel={() => setReplyTo(null)}
                    onSubmit={(body, mentionedUserIds) => post.mutate({ body, mentionedUserIds, parentId: note.id })}
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
            {loadMore.isPending ? 'Loading…' : 'Load earlier messages'}
          </Button>
        </div>
      )}
    </div>
  );
}
