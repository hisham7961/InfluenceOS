'use client';
import { useTranslations } from 'next-intl';
import { Menu, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BrandSwitcher } from './brand-switcher';
import { NotificationsMenu } from './notifications-menu';
import { ThemeToggle } from './theme-toggle';
import { LocaleToggle } from './locale-toggle';
import { UserMenu } from './user-menu';
import { useApp, type QuickAddKind } from './app-context';

const QUICK_ADD: { kind: QuickAddKind; labelKey: string }[] = [
  { kind: 'influencer', labelKey: 'quickAddLabelInfluencer' },
  { kind: 'campaign', labelKey: 'quickAddLabelCampaign' },
  { kind: 'content', labelKey: 'quickAddLabelContent' },
  { kind: 'cost', labelKey: 'quickAddLabelCost' },
  { kind: 'brand', labelKey: 'quickAddLabelBrand' },
];

export function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const { openCommand, openQuickAdd } = useApp();
  const t = useTranslations('common');

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur-xl lg:px-6 print:hidden">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onOpenMobileNav} aria-label={t('menu')}>
        <Menu className="h-5 w-5" />
      </Button>

      <button
        onClick={openCommand}
        className="hidden h-10 w-72 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-muted sm:flex"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-start">{t('search')}</span>
        <kbd className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
      </button>
      <Button variant="ghost" size="icon-sm" className="sm:hidden" onClick={openCommand} aria-label={t('searchButton')}>
        <Search className="h-5 w-5" />
      </Button>

      <div className="flex-1" />

      <BrandSwitcher />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">{t('quickAdd')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {QUICK_ADD.map((q) => (
            <DropdownMenuItem key={q.kind} onClick={() => openQuickAdd(q.kind)}>
              <Plus className="h-4 w-4 text-muted-foreground" /> {t(q.labelKey)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="hidden items-center gap-0.5 sm:flex">
        <LocaleToggle />
        <ThemeToggle />
      </div>
      <NotificationsMenu />
      <UserMenu />
    </header>
  );
}
