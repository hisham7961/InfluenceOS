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
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  /** Key into the `nav` message namespace — resolved with `useTranslations('nav')` by the consuming component. */
  labelKey: string;
  icon: LucideIcon;
  exact?: boolean;
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
