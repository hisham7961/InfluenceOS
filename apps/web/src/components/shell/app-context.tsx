'use client';
import * as React from 'react';
import type { BrandSummaryDTO, Capability, UserDTO } from '@influenceos/contracts';

interface AppContextValue {
  user: UserDTO;
  /** Whether the signed-in user has a capability (admins have all). The
   *  server enforces it either way; this only hides what would be refused. */
  can: (capability: Capability) => boolean;
  brands: BrandSummaryDTO[];
  openCommand: () => void;
  openQuickAdd: (kind?: QuickAddKind) => void;
}

export type QuickAddKind = 'influencer' | 'campaign' | 'content' | 'cost' | 'brand';

const AppContext = React.createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = React.useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function AppProvider({
  user,
  brands,
  openCommand,
  openQuickAdd,
  children,
}: {
  user: UserDTO;
  brands: BrandSummaryDTO[];
  openCommand: () => void;
  openQuickAdd: (kind?: QuickAddKind) => void;
  children: React.ReactNode;
}) {
  const value = React.useMemo(() => {
    const granted = user.capabilities ? new Set(user.capabilities) : null;
    const can = (capability: Capability) => user.role === 'ADMIN' || !granted || granted.has(capability);
    return { user, can, brands, openCommand, openQuickAdd };
  }, [user, brands, openCommand, openQuickAdd]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
