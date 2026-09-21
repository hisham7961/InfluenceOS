'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bookmark, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/**
 * Saved directory views / segments (W3-6 web surface). Save the current filter
 * combination under a name and re-apply it later. Self-contained: it reads and
 * writes the URL params in `paramKeys`, so it works for any filtered directory.
 */
export function SavedViews({
  scope,
  basePath,
  current,
}: {
  scope: string;
  basePath: string;
  current: Record<string, string>;
}) {
  const router = useRouter();
  const t = useTranslations('influencers');
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['saved-views', scope], queryFn: () => api.savedViews.list(scope) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['saved-views', scope] });
  const create = useMutation({
    mutationFn: (name: string) => {
      const filters = Object.fromEntries(Object.entries(current).filter(([, v]) => v));
      return api.savedViews.create({ scope, name, filters, isShared: false });
    },
    onSuccess: () => { invalidate(); toast.success(t('directory.savedViews.viewSaved')); },
    onError: (e) => toast.error(errorMessage(e, t('errors.generic'))),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.savedViews.remove(id),
    onSuccess: () => { invalidate(); toast.success(t('directory.savedViews.viewDeleted')); },
    onError: (e) => toast.error(errorMessage(e, t('errors.generic'))),
  });

  function apply(filters: unknown) {
    const f = (filters ?? {}) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) params.set(k, String(v));
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  function save() {
    const name = typeof window !== 'undefined' ? window.prompt(t('directory.savedViews.namePrompt'))?.trim() : '';
    if (name) create.mutate(name);
  }

  const views = data ?? [];
  const hasCurrent = Object.values(current).some(Boolean);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" size="sm" className="gap-1.5">
          <Bookmark className="h-3.5 w-3.5" aria-hidden /> {t('directory.savedViews.trigger')}
          {views.length > 0 ? <span className="text-xs text-muted-foreground">({views.length})</span> : null}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>{t('directory.savedViews.label')}</DropdownMenuLabel>
        {views.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('directory.savedViews.empty')}</p>
        ) : (
          views.map((v) => (
            <DropdownMenuItem key={v.id} onSelect={() => apply(v.filters)} className="flex items-center justify-between gap-2">
              <span className="truncate">{v.name}</span>
              {v.isOwn ? (
                <button
                  type="button"
                  aria-label={t('directory.savedViews.deleteAriaLabel', { name: v.name })}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); remove.mutate(v.id); }}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); save(); }} disabled={!hasCurrent || create.isPending}>
          <Plus className="me-2 h-3.5 w-3.5" aria-hidden /> {t('directory.savedViews.saveCurrent')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
