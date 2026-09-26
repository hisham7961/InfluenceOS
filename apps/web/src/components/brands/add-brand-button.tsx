'use client';

import { Plus } from 'lucide-react';
import { useApp } from '@/components/shell/app-context';
import { Button } from '@/components/ui/button';

/** Opens the Quick add "New brand" form (admins only — the page decides). */
export function AddBrandButton({ label }: { label: string }) {
  const { openQuickAdd } = useApp();
  return (
    <Button size="sm" onClick={() => openQuickAdd('brand')}>
      <Plus className="h-4 w-4" /> {label}
    </Button>
  );
}
