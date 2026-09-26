'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Command } from 'cmdk';
import { Megaphone, PlusCircle, Search, Store, UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api-browser';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { NAV_ITEMS } from './nav';
import { useApp } from './app-context';

// SearchResultDTO['type'] isn't part of the shared enums.json registry (see
// apps/web/src/lib/enum-labels.ts) — it's a small, closed set local to global
// search, so it's mapped to the same entity-noun keys the Quick Add menu uses
// rather than inventing a parallel mini-enum namespace.
const RESULT_TYPE_LABEL_KEY: Record<string, string> = {
  influencer: 'quickAddLabelInfluencer',
  campaign: 'quickAddLabelCampaign',
  brand: 'quickAddLabelBrand',
  published_content: 'quickAddLabelContent',
};

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const { openQuickAdd, can } = useApp();
  const [query, setQuery] = React.useState('');
  const t = useTranslations('common');
  const tNav = useTranslations('nav');
  const tSearch = useTranslations('search');

  const { data: results } = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.search.query({ q: query, limit: 8 }),
    enabled: query.trim().length >= 2,
  });

  function go(path: string) {
    onOpenChange(false);
    setQuery('');
    router.push(path);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <Command shouldFilter={false} className="[&_[cmdk-input]]:outline-none">
          <div className="border-border flex items-center gap-2 border-b px-4">
            <Search className="text-muted-foreground h-4 w-4" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder={t('commandPaletteSearchPlaceholder')}
              className="placeholder:text-muted-foreground h-12 flex-1 bg-transparent text-sm outline-none"
              autoFocus
            />
          </div>
          <Command.List className="max-h-96 overflow-y-auto p-2">
            <Command.Empty className="text-muted-foreground py-8 text-center text-sm">
              {query.trim().length >= 2 ? t('noMatchesFound') : t('typeToSearch')}
            </Command.Empty>

            {results && results.length > 0 && (
              <Command.Group
                heading={t('results')}
                className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium"
              >
                {results.map((r) => (
                  <Command.Item
                    key={`${r.type}-${r.id}`}
                    value={`${r.type}-${r.id}`}
                    onSelect={() => go(r.link)}
                    className="data-[selected=true]:bg-surface-muted flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm"
                  >
                    <TypeIcon type={r.type} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.title}</p>
                      {r.subtitle && (
                        <p className="text-muted-foreground truncate text-xs">{r.subtitle}</p>
                      )}
                    </div>
                    <span className="text-muted-foreground text-[10px] uppercase">
                      {t(RESULT_TYPE_LABEL_KEY[r.type] ?? 'quickAddLabelContent')}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {query.trim().length >= 2 && (
              <Command.Group className="[&_[cmdk-group-heading]]:px-2">
                {/* The full page also searches notes, tags and captions (P3.7). */}
                <Action
                  label={tSearch('seeAll', { q: query.trim() })}
                  icon={Search}
                  onSelect={() => go(`/search?q=${encodeURIComponent(query.trim())}`)}
                />
              </Command.Group>
            )}

            <Command.Group
              heading={t('quickActions')}
              className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium"
            >
              <Action
                label={t('addInfluencerTitle')}
                icon={UserPlus}
                onSelect={() => {
                  onOpenChange(false);
                  openQuickAdd('influencer');
                }}
              />
              <Action
                label={t('addCampaignAction')}
                icon={Megaphone}
                onSelect={() => {
                  onOpenChange(false);
                  openQuickAdd('campaign');
                }}
              />
              <Action
                label={t('addPublishedContentTitle')}
                icon={PlusCircle}
                onSelect={() => {
                  onOpenChange(false);
                  openQuickAdd('content');
                }}
              />
            </Command.Group>

            <Command.Group
              heading={tNav('navigateHeading')}
              className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium"
            >
              {NAV_ITEMS.filter((item) => !item.requires || can(item.requires)).map((item) => (
                <Action
                  key={item.href}
                  label={tNav(item.labelKey)}
                  icon={item.icon}
                  onSelect={() => go(item.href)}
                />
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Action({
  label,
  icon: Icon,
  onSelect,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className="data-[selected=true]:bg-surface-muted flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm"
    >
      <Icon className="text-muted-foreground h-4 w-4" />
      {label}
    </Command.Item>
  );
}

function TypeIcon({ type }: { type: string }) {
  const Icon =
    type === 'influencer'
      ? Users
      : type === 'campaign'
        ? Megaphone
        : type === 'brand'
          ? Store
          : PlusCircle;
  return (
    <span className="bg-surface-muted flex h-8 w-8 items-center justify-center rounded-lg">
      <Icon className="text-muted-foreground h-4 w-4" />
    </span>
  );
}
