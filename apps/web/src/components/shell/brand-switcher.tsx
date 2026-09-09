'use client';
import { usePathname, useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, Globe } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';
import { useApp } from './app-context';

export function BrandSwitcher() {
  const { brands } = useApp();
  const router = useRouter();
  const pathname = usePathname();

  const match = pathname.match(/^\/brands\/([^/]+)/);
  const currentSlug = match?.[1];
  const current = brands.find((b) => b.slug === currentSlug);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-xl border border-border bg-surface px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-surface-muted">
          {current ? (
            <span
              className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold text-white"
              style={{ backgroundColor: current.primaryColor }}
            >
              {current.name.slice(0, 1)}
            </span>
          ) : (
            <Globe className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="max-w-[10rem] truncate">{current ? current.name : 'All brands'}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => router.push('/')}>
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">All brands (Global)</span>
          {!current && <Check className="h-4 w-4" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Brands</DropdownMenuLabel>
        {brands.map((b) => (
          <DropdownMenuItem key={b.id} onClick={() => router.push(`/brands/${b.slug}`)}>
            <span
              className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold text-white"
              style={{ backgroundColor: b.primaryColor }}
            >
              {b.name.slice(0, 1)}
            </span>
            <span className={cn('flex-1 truncate', !b.isActive && 'text-muted-foreground')}>{b.name}</span>
            {current?.id === b.id && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
