import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Building2,
  User,
  ArrowLeftRight,
  PiggyBank,
  FileBarChart,
  Settings,
  Repeat,
  Target,
  Flame,
  Receipt,
  CreditCard,
  Sparkles,
} from 'lucide-react';

export interface NavItem {
  href: string;
  icon: LucideIcon;
  labelKey:
    | 'dashboard'
    | 'assistant'
    | 'businesses'
    | 'personal'
    | 'transfers'
    | 'recurring'
    | 'investments'
    | 'fire'
    | 'budgets'
    | 'reports'
    | 'tax'
    | 'creditCards'
    | 'settings';
}

/**
 * Single source of truth for the app's 13 top-level destinations. Consumed
 * by the desktop sidebar (full list) and, on mobile, split into the 4
 * bottom-nav primaries plus the "more" sheet's remaining 9 — see
 * MOBILE_PRIMARY_ITEMS / MOBILE_MORE_ITEMS below.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { href: '/assistant', icon: Sparkles, labelKey: 'assistant' },
  { href: '/businesses', icon: Building2, labelKey: 'businesses' },
  { href: '/personal', icon: User, labelKey: 'personal' },
  { href: '/transfers', icon: ArrowLeftRight, labelKey: 'transfers' },
  { href: '/recurring', icon: Repeat, labelKey: 'recurring' },
  { href: '/investments', icon: PiggyBank, labelKey: 'investments' },
  { href: '/fire', icon: Flame, labelKey: 'fire' },
  { href: '/budgets', icon: Target, labelKey: 'budgets' },
  { href: '/reports', icon: FileBarChart, labelKey: 'reports' },
  { href: '/tax', icon: Receipt, labelKey: 'tax' },
  { href: '/credit-cards', icon: CreditCard, labelKey: 'creditCards' },
  { href: '/settings', icon: Settings, labelKey: 'settings' },
];

function navItem(href: string): NavItem {
  const item = NAV_ITEMS.find((i) => i.href === href);
  if (!item) throw new Error(`nav-items: no NAV_ITEMS entry for "${href}"`);
  return item;
}

/**
 * The 4 phone-frequency tasks that earn a permanent bottom-nav slot: check
 * status, view/log day-to-day transactions, move money, ask the assistant.
 * Everything else — including Businesses, which is management/setup work
 * reachable from the dashboard — lives behind "Mais".
 */
export const MOBILE_PRIMARY_ITEMS: readonly NavItem[] = [
  navItem('/dashboard'),
  navItem('/personal'),
  navItem('/transfers'),
  navItem('/assistant'),
];

const mobilePrimaryHrefs = new Set(MOBILE_PRIMARY_ITEMS.map((item) => item.href));

export const MOBILE_MORE_ITEMS: readonly NavItem[] = NAV_ITEMS.filter(
  (item) => !mobilePrimaryHrefs.has(item.href)
);

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
