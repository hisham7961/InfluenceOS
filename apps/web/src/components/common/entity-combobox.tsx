'use client';

import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Command } from 'cmdk';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { api } from '@/lib/api-browser';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Avatar } from '@/components/ui/avatar';
import { Spinner } from '@/components/ui/spinner';
import { BidiText } from '@/components/common/bidi-text';
import { cn } from '@/lib/cn';

export type EntityKind = 'influencer' | 'campaign';

export interface EntityOption {
  id: string;
  label: string;
  /** A second, quieter line: the creator's handle, or the campaign's brand. */
  detail?: string | null;
  avatarUrl?: string | null;
}

const PAGE_SIZE = 20;

async function searchEntities(
  kind: EntityKind,
  q: string,
  brandId: string | undefined,
): Promise<{ options: EntityOption[]; total: number }> {
  const query = { q: q || undefined, pageSize: PAGE_SIZE, brandId: brandId || undefined };
  if (kind === 'influencer') {
    const res = await api.influencers.list(query);
    return {
      options: res.data.map((i) => ({
        id: i.id,
        label: i.displayName,
        detail: i.primaryUsername ? `@${i.primaryUsername}` : null,
        avatarUrl: i.avatarUrl,
      })),
      total: res.pagination.total,
    };
  }
  const res = await api.campaigns.list(query);
  return {
    options: res.data.map((c) => ({ id: c.id, label: c.name, detail: c.brand.name })),
    total: res.pagination.total,
  };
}

async function fetchLabel(kind: EntityKind, id: string): Promise<EntityOption> {
  if (kind === 'influencer') {
    const i = await api.influencers.get(id);
    return { id, label: i.displayName, avatarUrl: i.avatarUrl };
  }
  const c = await api.campaigns.get(id);
  return { id, label: c.name, detail: c.brand.name };
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * A searchable picker for a creator or a campaign. It asks the server as you
 * type, so it finds any of them — the dropdowns it replaces only ever listed
 * the first 100. `noneLabel` adds a first choice that clears the value ("All
 * campaigns", "Not linked"). Pass `valueLabel` when the caller already knows
 * the current value's name; otherwise it's looked up once.
 */
export function EntityCombobox({
  kind,
  value,
  onChange,
  valueLabel,
  placeholder,
  noneLabel,
  brandId,
  disabled,
  className,
  id,
  'aria-label': ariaLabel,
}: {
  kind: EntityKind;
  value: string;
  onChange: (id: string, option: EntityOption | null) => void;
  valueLabel?: string | null;
  placeholder: string;
  noneLabel?: string;
  brandId?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}) {
  const t = useTranslations('ui.combobox');
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const debounced = useDebounced(query.trim(), 250);
  // Names picked in this session, so the button shows one without a refetch.
  const [picked, setPicked] = React.useState<Record<string, EntityOption>>({});

  const results = useQuery({
    queryKey: ['entity-options', kind, brandId ?? '', debounced],
    queryFn: () => searchEntities(kind, debounced, brandId),
    enabled: open,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const known = value
    ? (picked[value] ?? results.data?.options.find((o) => o.id === value))
    : undefined;
  const labelQuery = useQuery({
    queryKey: ['entity-label', kind, value],
    queryFn: () => fetchLabel(kind, value),
    enabled: !!value && !valueLabel && !known,
    staleTime: 5 * 60_000,
  });
  // With a value and a "none" choice, a ✕ clears it in place of the chevron.
  const clearable = !!value && noneLabel !== undefined && !disabled;
  const current: EntityOption | null = value
    ? (known ?? (valueLabel ? { id: value, label: valueLabel } : (labelQuery.data ?? null)))
    : null;

  function choose(option: EntityOption | null) {
    if (option) setPicked((p) => ({ ...p, [option.id]: option }));
    onChange(option?.id ?? '', option);
    setOpen(false);
    setQuery('');
  }

  const options = results.data?.options ?? [];
  const more = (results.data?.total ?? 0) > options.length;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery('');
      }}
    >
      <div className={cn('relative', className)}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            id={id}
            aria-label={ariaLabel}
            role="combobox"
            aria-haspopup="dialog"
            aria-expanded={open}
            className={cn(
              'border-border bg-surface shadow-soft focus:ring-ring focus:ring-offset-background flex h-10 w-full items-center justify-between gap-2 rounded-lg border px-3 text-start text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              current ? 'text-foreground' : 'text-muted-foreground',
              clearable && 'pe-9',
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {current ? (
                <>
                  <BidiText>{current.label}</BidiText>
                  {current.detail ? (
                    <span className="text-muted-foreground"> · {current.detail}</span>
                  ) : null}
                </>
              ) : value ? (
                '…'
              ) : (
                (noneLabel ?? placeholder)
              )}
            </span>
            {clearable ? null : <ChevronDown className="text-muted-foreground size-4 shrink-0" />}
          </button>
        </PopoverTrigger>
        {clearable ? (
          <button
            type="button"
            onClick={() => choose(null)}
            className="text-muted-foreground hover:bg-surface-muted hover:text-foreground absolute end-2.5 top-1/2 -translate-y-1/2 rounded p-0.5"
            aria-label={t('clear')}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      {/* Gone the moment a choice is made (no fade-out), so a closing picker never lingers next to the dialog it sits in. */}
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0 data-[state=closed]:!animate-none"
        align="start"
      >
        <Command shouldFilter={false} loop>
          <div className="border-border flex items-center gap-2 border-b px-3">
            <Search className="text-muted-foreground size-4 shrink-0" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder={t('searchPlaceholder')}
              className="placeholder:text-muted-foreground h-10 flex-1 bg-transparent text-sm outline-none"
              autoFocus
            />
            {results.isFetching ? <Spinner className="size-3.5" /> : null}
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-1">
            {noneLabel !== undefined && !debounced ? (
              <EntityItem selected={!value} onSelect={() => choose(null)} value="__none__">
                <span className="text-muted-foreground">{noneLabel}</span>
              </EntityItem>
            ) : null}
            {options.map((o) => (
              <EntityItem
                key={o.id}
                value={o.id}
                selected={o.id === value}
                onSelect={() => choose(o)}
              >
                {kind === 'influencer' ? (
                  <Avatar name={o.label} src={o.avatarUrl ?? undefined} size="sm" />
                ) : null}
                <span className="min-w-0 flex-1">
                  <BidiText as="span" className="block truncate">
                    {o.label}
                  </BidiText>
                  {o.detail ? (
                    <span className="text-muted-foreground block truncate text-xs">{o.detail}</span>
                  ) : null}
                </span>
              </EntityItem>
            ))}
            {results.isSuccess && options.length === 0 ? (
              <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                {debounced ? t('noMatches', { query: debounced }) : t('searching')}
              </p>
            ) : null}
            {results.isPending ? (
              <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                {t('searching')}
              </p>
            ) : null}
            {more ? (
              <p className="text-muted-foreground px-3 py-2 text-xs">{t('typeMore')}</p>
            ) : null}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function EntityItem({
  value,
  selected,
  onSelect,
  children,
}: {
  value: string;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="aria-selected:bg-surface-muted flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
    >
      {children}
      <Check
        className={cn('text-brand ms-auto size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
      />
    </Command.Item>
  );
}
