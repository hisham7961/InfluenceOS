'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Film, ImageIcon, Paperclip, Trash2, Upload, X } from 'lucide-react';
import type { AttachmentDTO, AttachmentTarget } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { toBrowserUrl, uploadAttachment } from '@/lib/upload';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function KindIcon({ kind }: { kind: AttachmentDTO['kind'] }) {
  const Icon = kind === 'video' ? Film : kind === 'pdf' || kind === 'document' ? FileText : Paperclip;
  return <Icon className="h-5 w-5" />;
}

interface UploadState {
  id: string;
  name: string;
  fraction: number;
  error?: string;
}

/**
 * Reusable attachments panel — lists files for a target (campaign, deliverable,
 * script, influencer or note) and uploads new ones via the two-phase signed
 * flow with per-file progress. Downloads use short-lived signed URLs; nothing
 * is ever served from a public bucket.
 */
export function AttachmentsPanel({
  target,
  title = 'Files',
  compact = false,
}: {
  target: AttachmentTarget;
  title?: string;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = React.useState<UploadState[]>([]);
  const [dragging, setDragging] = React.useState(false);

  const queryKey = ['attachments', target];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => api.files.list(target),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.files.remove(id),
    onSuccess: () => {
      toast.success('File removed');
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    for (const file of list) {
      const uid = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setUploads((prev) => [...prev, { id: uid, name: file.name, fraction: 0 }]);
      try {
        await uploadAttachment(file, target, (fraction) =>
          setUploads((prev) => prev.map((u) => (u.id === uid ? { ...u, fraction } : u))),
        );
        setUploads((prev) => prev.filter((u) => u.id !== uid));
        queryClient.invalidateQueries({ queryKey });
        toast.success(`Uploaded ${file.name}`);
      } catch (e) {
        const message = errorMessage(e);
        setUploads((prev) => prev.map((u) => (u.id === uid ? { ...u, error: message } : u)));
        toast.error(message);
      }
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  const attachments = data ?? [];

  return (
    <div className="space-y-4">
      {!compact ? (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Upload
          </Button>
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-surface-muted/40 px-6 py-8 text-center transition-colors hover:border-brand/50 hover:bg-surface-muted',
          dragging && 'border-brand bg-brand-soft/40',
        )}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">Drop files here or click to upload</p>
        <p className="text-xs text-muted-foreground">Images, PDF, video and documents</p>
      </div>

      {uploads.length > 0 ? (
        <div className="space-y-2">
          {uploads.map((u) => (
            <div key={u.id} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium">{u.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {u.error ? 'Failed' : `${Math.round(u.fraction * 100)}%`}
                </span>
              </div>
              {u.error ? (
                <p className="text-xs text-danger">{u.error}</p>
              ) : (
                <ProgressBar value={u.fraction * 100} tone="brand" />
              )}
            </div>
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : attachments.length === 0 && uploads.length === 0 ? (
        <EmptyState icon={Paperclip} title="No files yet" description="Upload briefs, contracts, references and assets." className="border-0" />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {attachments.map((a) => (
            <AttachmentRow key={a.id} attachment={a} onRemove={() => removeMutation.mutate(a.id)} removing={removeMutation.isPending} />
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentRow({
  attachment,
  onRemove,
  removing,
}: {
  attachment: AttachmentDTO;
  onRemove: () => void;
  removing: boolean;
}) {
  const href = toBrowserUrl(attachment.downloadUrl);
  return (
    <div className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-muted text-muted-foreground"
      >
        {attachment.isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={href} alt={attachment.fileName} className="h-full w-full object-cover" />
        ) : (
          <KindIcon kind={attachment.kind} />
        )}
      </a>
      <div className="min-w-0 flex-1">
        <a href={href} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">
          {attachment.fileName}
        </a>
        <p className="truncate text-xs text-muted-foreground">
          {formatBytes(attachment.sizeBytes)}
          {attachment.uploadedByName ? ` · ${attachment.uploadedByName}` : ''} · {relativeTime(attachment.createdAt)}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label={`Delete ${attachment.fileName}`}
        className="shrink-0 rounded-lg p-2 text-muted-foreground opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Small helper icon kept for callers that render their own header. */
export { ImageIcon, X };
