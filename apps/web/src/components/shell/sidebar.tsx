'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { useConversationUnread } from '@/lib/use-conversation-unread';
import { NAV_SECTIONS } from './nav';
import { useApp } from './app-context';

const TEAM_CHAT_KEY = 'channel:general';

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const teamUnread = useConversationUnread(TEAM_CHAT_KEY);
  // My work / Approvals badges (P3.6), kept fresh without a page reload.
  const work = useQuery({
    queryKey: ['work-counts'],
    queryFn: () => api.work.counts(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const t = useTranslations('nav');
  const { can } = useApp();
  const sections = NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => !i.requires || can(i.requires)),
  })).filter((s) => s.items.length > 0);
  return (
    <nav className="flex flex-1 flex-col gap-4 px-3">
      {sections.map((section, si) => (
        <div key={section.labelKey ?? `section-${si}`} className="flex flex-col gap-1">
          {section.labelKey ? (
            <p className="text-muted-foreground/70 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider">
              {t(section.labelKey)}
            </p>
          ) : null}
          {section.items.map((item) => {
            const active = isActive(pathname, item.href, item.exact);
            const Icon = item.icon;
            const unread =
              item.href === '/team'
                ? teamUnread
                : item.href === '/my-work'
                  ? (work.data?.myWork ?? 0)
                  : item.href === '/approvals'
                    ? (work.data?.approvals ?? 0)
                    : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-brand-soft text-brand'
                    : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    'h-[18px] w-[18px]',
                    active ? 'text-brand' : 'text-muted-foreground group-hover:text-foreground',
                  )}
                />
                <span className="flex-1">{t(item.labelKey)}</span>
                {unread > 0 ? (
                  <span className="bg-brand flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  const t = useTranslations('common');
  return (
    <aside className="border-border bg-surface hidden w-64 shrink-0 flex-col border-e lg:flex print:!hidden">
      <div className="flex h-16 items-center gap-2.5 px-6">
        <div className="from-primary to-accent shadow-soft flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-black text-white">
          io
        </div>
        <span className="text-[15px] font-bold tracking-tight">InfluenceOS</span>
      </div>
      <NavLinks />
      <div className="p-4">
        <div className="border-border bg-surface-muted text-muted-foreground rounded-xl border p-3 text-xs">
          <p className="text-foreground font-medium">{t('commandCenter')}</p>
          <p className="mt-0.5">
            {t.rich('commandCenterHint', {
              kbd: (chunks) => (
                <kbd className="bg-card shadow-soft rounded px-1 py-0.5 font-mono text-[10px]">
                  {chunks}
                </kbd>
              ),
            })}
          </p>
        </div>
      </div>
    </aside>
  );
}
