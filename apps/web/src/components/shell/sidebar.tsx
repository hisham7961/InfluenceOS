'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { NAV_ITEMS } from './nav';

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'bg-brand-soft text-brand'
                : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
            )}
          >
            <Icon className={cn('h-[18px] w-[18px]', active ? 'text-brand' : 'text-muted-foreground group-hover:text-foreground')} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-e border-border bg-surface lg:flex">
      <div className="flex h-16 items-center gap-2.5 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-sm font-black text-white shadow-soft">
          io
        </div>
        <span className="text-[15px] font-bold tracking-tight">InfluenceOS</span>
      </div>
      <NavLinks />
      <div className="p-4">
        <div className="rounded-xl border border-border bg-surface-muted p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Command center</p>
          <p className="mt-0.5">Press <kbd className="rounded bg-card px-1 py-0.5 font-mono text-[10px] shadow-soft">⌘K</kbd> to search anywhere.</p>
        </div>
      </div>
    </aside>
  );
}
