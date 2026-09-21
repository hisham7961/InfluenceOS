'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pin, PinOff, StickyNote, Trash2 } from 'lucide-react';
import type { NoteDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { uploadAttachment } from '@/lib/upload';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { AttachmentChip, Composer } from '@/components/collaboration/comment-thread';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

/** Internal notes thread for an influencer — pin, add, and remove, with optimistic list updates.
 *  Shares its composer (including the @mention picker) with the rest of the Collaboration Layer. */
export function NotesPanel({ influencerId, notes }: { influencerId: string; notes: NoteDTO[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [items, setItems] = React.useState(notes);

  React.useEffect(() => setItems(notes), [notes]);

  const sorted = React.useMemo(
    () =>
      [...items].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [items],
  );

  function onError(e: unknown) {
    toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
  }

  const createNote = useMutation({
    mutationFn: async ({ body, mentionedUserIds, files }: { body: string; mentionedUserIds: string[]; files: File[] }) => {
      const note = await api.notes.create({ body, influencerId, mentionedUserIds });
      if (files.length === 0) return note;
      for (const file of files) {
        try {
          await uploadAttachment(file, { noteId: note.id });
        } catch (e) {
          toast.error(`"${file.name}" didn't attach: ${e instanceof ApiError ? e.message : 'upload failed'}`);
        }
      }
      // The note object returned above predates its own attachments (they
      // can only be uploaded once the note exists) — re-fetch the list so
      // the card we prepend actually shows what just got attached, instead
      // of a stale zero-attachments snapshot.
      const refreshed = await api.influencers.notes(influencerId);
      return refreshed.find((n) => n.id === note.id) ?? note;
    },
    onSuccess: (note) => {
      setItems((prev) => [note, ...prev]);
      toast.success('Note added');
      queryClient.invalidateQueries();
      router.refresh();
    },
    onError,
  });

  const togglePin = useMutation({
    mutationFn: (note: NoteDTO) => api.notes.update(note.id, { pinned: !note.pinned }),
    onSuccess: (updated) => {
      setItems((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      queryClient.invalidateQueries();
      router.refresh();
    },
    onError,
  });

  const removeNote = useMutation({
    mutationFn: (id: string) => api.notes.remove(id),
    onSuccess: (_data, id) => {
      setItems((prev) => prev.filter((n) => n.id !== id));
      toast.success('Note removed');
      queryClient.invalidateQueries();
      router.refresh();
    },
    onError,
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <Card className="h-fit p-4">
        <p className="mb-3 text-sm font-semibold">Add a note</p>
        <Composer
          onSubmit={(body, mentionedUserIds, files) => createNote.mutate({ body, mentionedUserIds, files })}
          pending={createNote.isPending}
          placeholder="Log a call, a rate negotiation, a red flag… use @ to mention someone"
        />
      </Card>

      {sorted.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title="No notes yet"
          description="Internal notes about this influencer will show up here."
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((note) => (
            <Card key={note.id} className={cn('p-4', note.pinned && 'border-brand/40 bg-brand-soft/40')}>
              <div className="flex items-start gap-3">
                <Avatar name={note.authorName ?? 'Unknown'} size="sm" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{note.authorName ?? 'Unknown'}</p>
                    <span className="text-xs text-muted-foreground">{relativeTime(note.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
                  {note.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {note.attachments.map((a) => (
                        <AttachmentChip key={a.id} id={a.id} fileName={a.fileName} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={note.pinned ? 'Unpin note' : 'Pin note'}
                    disabled={togglePin.isPending}
                    onClick={() => togglePin.mutate(note)}
                  >
                    {note.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Delete note"
                    disabled={removeNote.isPending}
                    onClick={() => removeNote.mutate(note.id)}
                  >
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
