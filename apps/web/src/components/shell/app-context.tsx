'use client';
import * as React from 'react';
import type { BrandSummaryDTO, UserDTO } from '@influenceos/contracts';

interface AppContextValue {
  user: UserDTO;
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
  const value = React.useMemo(
    () => ({ user, brands, openCommand, openQuickAdd }),
    [user, brands, openCommand, openQuickAdd],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
