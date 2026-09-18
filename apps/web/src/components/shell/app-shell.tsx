'use client';
import * as React from 'react';
import type { BrandSummaryDTO, UserDTO } from '@influenceos/contracts';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { NavLinks, Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { CommandPalette } from './command-palette';
import { QuickAdd } from './quick-add';
import { AppProvider, type QuickAddKind } from './app-context';

export function AppShell({
  user,
  brands,
  children,
  maintenance = null,
}: {
  user: UserDTO;
  brands: BrandSummaryDTO[];
  children: React.ReactNode;
  /** When set, a maintenance banner is shown (W4-2). The string is the message. */
  maintenance?: string | null;
}) {
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [quickAdd, setQuickAdd] = React.useState<{ open: boolean; kind: QuickAddKind }>({ open: false, kind: 'content' });
  const [mobileNav, setMobileNav] = React.useState(false);

  const openCommand = React.useCallback(() => setCommandOpen(true), []);
  const openQuickAdd = React.useCallback((kind: QuickAddKind = 'content') => setQuickAdd({ open: true, kind }), []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <AppProvider user={user} brands={brands} openCommand={openCommand} openQuickAdd={openQuickAdd}>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenMobileNav={() => setMobileNav(true)} />
          {maintenance !== null && (
            <div
              role="status"
              className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm font-medium text-warning lg:px-8"
            >
              {maintenance || 'The system is under maintenance. Some actions are temporarily unavailable.'}
              {user.role !== 'ADMIN' && ' Changes are read-only until this clears.'}
            </div>
          )}
          <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
        </div>
      </div>

      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="w-72 p-0 sm:max-w-xs">
          <div className="flex h-16 items-center gap-2.5 px-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-sm font-black text-white">io</div>
            <span className="font-bold">InfluenceOS</span>
          </div>
          <NavLinks onNavigate={() => setMobileNav(false)} />
        </SheetContent>
      </Sheet>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <QuickAdd open={quickAdd.open} kind={quickAdd.kind} onOpenChange={(open) => setQuickAdd((s) => ({ ...s, open }))} />
    </AppProvider>
  );
}
