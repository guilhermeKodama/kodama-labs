import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, Sparkles } from 'lucide-react';

export interface NavItem {
  href: string;
  icon: LucideIcon;
  labelKey: 'dashboard' | 'assistant';
}

/**
 * Top-level destinations while the new UI is built: the placeholder home
 * and the assistant. Consumed by the sidebar and the mobile bottom nav.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { href: '/assistant', icon: Sparkles, labelKey: 'assistant' },
];

export const MOBILE_PRIMARY_ITEMS: readonly NavItem[] = NAV_ITEMS;

export const MOBILE_MORE_ITEMS: readonly NavItem[] = [];

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
