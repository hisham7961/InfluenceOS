'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Megaphone, PlusCircle, Search, Store, UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api-browser';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { NAV_ITEMS } from './nav';
import { useApp } from './app-context';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const { openQuickAdd } = useApp();
  const [query, setQuery] = React.useState('');

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
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search influencers, campaigns, brands, content…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>
          <Command.List className="max-h-96 overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
              {query.trim().length >= 2 ? 'No matches found.' : 'Type to search…'}
            </Command.Empty>

            {results && results.length > 0 && (
              <Command.Group heading="Results" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
                {results.map((r) => (
                  <Command.Item
                    key={`${r.type}-${r.id}`}
                    value={`${r.type}-${r.id}`}
                    onSelect={() => go(r.link)}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-surface-muted"
                  >
                    <TypeIcon type={r.type} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.title}</p>
                      {r.subtitle && <p className="truncate text-xs text-muted-foreground">{r.subtitle}</p>}
                    </div>
                    <span className="text-[10px] uppercase text-muted-foreground">{r.type.replace('_', ' ')}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="Quick actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
              <Action label="Add influencer" icon={UserPlus} onSelect={() => { onOpenChange(false); openQuickAdd('influencer'); }} />
              <Action label="Add campaign" icon={Megaphone} onSelect={() => { onOpenChange(false); openQuickAdd('campaign'); }} />
              <Action label="Add published content" icon={PlusCircle} onSelect={() => { onOpenChange(false); openQuickAdd('content'); }} />
            </Command.Group>

            <Command.Group heading="Navigate" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
              {NAV_ITEMS.map((item) => (
                <Action key={item.href} label={item.label} icon={item.icon} onSelect={() => go(item.href)} />
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Action({ label, icon: Icon, onSelect }: { label: string; icon: React.ComponentType<{ className?: string }>; onSelect: () => void }) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-surface-muted"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      {label}
    </Command.Item>
  );
}

function TypeIcon({ type }: { type: string }) {
  const Icon = type === 'influencer' ? Users : type === 'campaign' ? Megaphone : type === 'brand' ? Store : PlusCircle;
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-muted">
      <Icon className="h-4 w-4 text-muted-foreground" />
    </span>
  );
}
