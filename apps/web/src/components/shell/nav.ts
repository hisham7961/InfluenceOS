import {
  Bell,
  CalendarDays,
  LayoutDashboard,
  Megaphone,
  PlaySquare,
  Settings,
  Sparkles,
  Store,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Mission Control', icon: LayoutDashboard, exact: true },
  { href: '/brands', label: 'Brands', icon: Store },
  { href: '/influencers', label: 'Influencers', icon: Users },
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/content', label: 'Live Content', icon: PlaySquare },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/reports', label: 'Reports', icon: Sparkles },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/settings', label: 'Settings', icon: Settings },
];
