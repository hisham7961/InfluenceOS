'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LogOut, Settings, UserCircle } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { BidiText, LtrText } from '@/components/common/bidi-text';
import { useApp } from './app-context';

export function UserMenu() {
  const { user } = useApp();
  const t = useTranslations('common');
  const tNav = useTranslations('nav');

  async function logout() {
    await fetch('/api/session/logout', { method: 'POST' });
    // A full page load: nothing from the signed-in session (cached pages,
    // query data) survives, and it can't stall like a soft navigation.
    window.location.assign('/login');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full ring-offset-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar name={user.name} src={user.avatarUrl} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="font-semibold"><BidiText>{user.name}</BidiText></span>
            <LtrText as="span" className="text-xs font-normal text-muted-foreground">{user.email}</LtrText>
          </div>
          <Badge tone={user.role === 'ADMIN' ? 'accent' : 'info'} className="mt-2 w-fit">
            {user.role === 'ADMIN' ? t('administrator') : t('staff')}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <UserCircle className="h-4 w-4" /> {t('profileAndPreferences')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="h-4 w-4" /> {tNav('settings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} className="text-danger focus:text-danger">
          <LogOut className="h-4 w-4" /> {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
