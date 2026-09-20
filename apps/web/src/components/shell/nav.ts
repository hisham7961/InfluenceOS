import {
  Bell,
  CalendarDays,
  Gauge,
  LayoutDashboard,
  Megaphone,
  Package,
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

export interface NavSection {
  /** Section heading; omitted for the top (dashboard) group. */
  label?: string;
  items: NavItem[];
}

// Grouped navigation (W5-5 / UX-11) — related destinations sit together so the
// sidebar reads as an information architecture, not a flat list.
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ href: '/', label: 'Mission Control', icon: LayoutDashboard, exact: true }],
  },
  {
    label: 'Workspace',
    items: [
      { href: '/brands', label: 'Brands', icon: Store },
      { href: '/influencers', label: 'Influencers', icon: Users },
      { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
      { href: '/content', label: 'Live Content', icon: PlaySquare },
      { href: '/calendar', label: 'Calendar', icon: CalendarDays },
      { href: '/logistics', label: 'Logistics', icon: Package },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/exec', label: 'Executive', icon: Gauge },
      { href: '/reports', label: 'Reports', icon: Sparkles },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/notifications', label: 'Notifications', icon: Bell },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

/** Flattened list (command palette, mobile nav). Derived from NAV_SECTIONS. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
