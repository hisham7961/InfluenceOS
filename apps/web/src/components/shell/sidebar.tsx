'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useConversationUnread } from '@/lib/use-conversation-unread';
import { NAV_SECTIONS } from './nav';

const TEAM_CHAT_KEY = 'channel:general';

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const teamUnread = useConversationUnread(TEAM_CHAT_KEY);
  const t = useTranslations('nav');
  return (
    <nav className="flex flex-1 flex-col gap-4 px-3">
      {NAV_SECTIONS.map((section, si) => (
        <div key={section.labelKey ?? `section-${si}`} className="flex flex-col gap-1">
          {section.labelKey ? (
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {t(section.labelKey)}
            </p>
          ) : null}
          {section.items.map((item) => {
            const active = isActive(pathname, item.href, item.exact);
            const Icon = item.icon;
            const unread = item.href === '/team' ? teamUnread : 0;
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
                <Icon aria-hidden className={cn('h-[18px] w-[18px]', active ? 'text-brand' : 'text-muted-foreground group-hover:text-foreground')} />
                <span className="flex-1">{t(item.labelKey)}</span>
                {unread > 0 ? (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">
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
          <p className="font-medium text-foreground">{t('commandCenter')}</p>
          <p className="mt-0.5">
            {t.rich('commandCenterHint', {
              kbd: (chunks) => (
                <kbd className="rounded bg-card px-1 py-0.5 font-mono text-[10px] shadow-soft">{chunks}</kbd>
              ),
            })}
          </p>
        </div>
      </div>
    </aside>
  );
}
