'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send, StickyNote } from 'lucide-react';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { relativeTime } from '@/lib/format';

/**
 * Compact internal-notes thread for the Content Viewer (item 47-48) — reuses
 * the SAME Note model/API as the Influencer notes panel, just a smaller
 * layout that fits the Viewer's narrow sidebar column rather than a
 * duplicate comment system. Staff commentary only ("Strong opening hook"),
 * never written into the social caption.
 */
export function ContentNotesPanel({ contentId }: { contentId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState('');
  const notes = useQuery({ queryKey: ['content-notes', contentId], queryFn: () => api.notes.forContent(contentId) });

  const createNote = useMutation({
    mutationFn: (body: string) => api.notes.create({ body, publishedContentId: contentId }),
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['content-notes', contentId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not add the note.'),
  });

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <StickyNote className="h-3.5 w-3.5" /> Notes
      </p>
      <div className="flex gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Strong opening hook… potential paid-media asset…"
          rows={2}
          className="text-sm"
        />
        <Button
          type="button"
          size="icon-sm"
          className="self-end"
          disabled={!draft.trim() || createNote.isPending}
          onClick={() => createNote.mutate(draft.trim())}
          aria-label="Add note"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
      {notes.data && notes.data.length > 0 ? (
        <div className="space-y-2">
          {notes.data.map((note) => (
            <div key={note.id} className="flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-2 text-sm">
              <Avatar name={note.authorName ?? 'Unknown'} size="xs" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">{note.authorName ?? 'Unknown'}</p>
                  <span className="text-xs text-muted-foreground">{relativeTime(note.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-foreground/90">{note.body}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
