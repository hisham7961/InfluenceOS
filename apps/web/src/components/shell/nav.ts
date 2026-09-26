import {
  Bell,
  CalendarDays,
  Gauge,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  MessagesSquare,
  Package,
  PlaySquare,
  Settings,
  ShieldAlert,
  Sparkles,
  Store,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Capability } from '@influenceos/contracts';

export interface NavItem {
  href: string;
  /** Key into the `nav` message namespace — resolved with `useTranslations('nav')` by the consuming component. */
  labelKey: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Shown only to users with this capability (the server refuses the page's data anyway). */
  requires?: Capability;
}

export interface NavSection {
  /** Key into the `nav` message namespace for the section heading; omitted for the top (dashboard) group. */
  labelKey?: string;
  items: NavItem[];
}

// Grouped navigation (W5-5 / UX-11) — related destinations sit together so the
// sidebar reads as an information architecture, not a flat list. Labels are
// translation keys, not literal text — see docs/localization/README.md.
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ href: '/', labelKey: 'missionControl', icon: LayoutDashboard, exact: true }],
  },
  {
    labelKey: 'workspace',
    items: [
      { href: '/brands', labelKey: 'brands', icon: Store },
      { href: '/influencers', labelKey: 'influencers', icon: Users },
      { href: '/campaigns', labelKey: 'campaigns', icon: Megaphone },
      { href: '/content', labelKey: 'liveContent', icon: PlaySquare },
      { href: '/calendar', labelKey: 'calendar', icon: CalendarDays },
      { href: '/logistics', labelKey: 'logistics', icon: Package },
      { href: '/inspiration', labelKey: 'inspiration', icon: Lightbulb },
      { href: '/team', labelKey: 'team', icon: MessagesSquare },
    ],
  },
  {
    labelKey: 'insights',
    items: [
      { href: '/exec', labelKey: 'executive', icon: Gauge },
      { href: '/finance', labelKey: 'finance', icon: Wallet, requires: 'FINANCE_VIEW' },
      { href: '/reports', labelKey: 'reports', icon: Sparkles },
      { href: '/data-quality', labelKey: 'dataQuality', icon: ShieldAlert },
    ],
  },
  {
    labelKey: 'account',
    items: [
      { href: '/notifications', labelKey: 'notifications', icon: Bell },
      { href: '/settings', labelKey: 'settings', icon: Settings },
    ],
  },
];

/** Flattened list (command palette, mobile nav). Derived from NAV_SECTIONS. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
