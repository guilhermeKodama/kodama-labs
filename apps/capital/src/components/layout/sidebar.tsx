'use client';

import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  Building2,
  User,
  ArrowLeftRight,
  PiggyBank,
  FileBarChart,
  Settings,
  TrendingUp,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/language-switcher';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/lib/store';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { href: '/businesses', icon: Building2, labelKey: 'businesses' },
  { href: '/personal', icon: User, labelKey: 'personal' },
  { href: '/transfers', icon: ArrowLeftRight, labelKey: 'transfers' },
  { href: '/investments', icon: PiggyBank, labelKey: 'investments' },
  { href: '/reports', icon: FileBarChart, labelKey: 'reports' },
  { href: '/settings', icon: Settings, labelKey: 'settings' },
] as const;

export function Sidebar() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { settings } = useSettingsStore();

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r border-slate-800 bg-slate-950 lg:flex">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500">
          <TrendingUp className="h-5 w-5 text-white" />
        </div>
        <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-xl font-bold text-transparent">
          Capital
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'
              )}
            >
              <item.icon className="h-5 w-5" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-slate-800 p-4">
        {/* User info */}
        {settings.userId && (
          <div className="mb-4 rounded-lg bg-slate-800/50 p-3">
            <p className="text-xs text-slate-500">{t('baseCurrency')}</p>
            <p className="font-medium text-slate-300">{settings.baseCurrency}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <LanguageSwitcher compact />
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
