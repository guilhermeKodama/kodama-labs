'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  User,
  ArrowLeftRight,
  PiggyBank,
  FileBarChart,
  Settings,
  TrendingUp,
  Repeat,
  Target,
  Receipt,
  CreditCard,
  LogOut,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/language-switcher';
import { cn } from '@/lib/utils';
import { useUser } from '@/lib/user-context';
import { Button } from '@/components/ui/button';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { href: '/businesses', icon: Building2, labelKey: 'businesses' },
  { href: '/personal', icon: User, labelKey: 'personal' },
  { href: '/transfers', icon: ArrowLeftRight, labelKey: 'transfers' },
  { href: '/recurring', icon: Repeat, labelKey: 'recurring' },
  { href: '/investments', icon: PiggyBank, labelKey: 'investments' },
  { href: '/budgets', icon: Target, labelKey: 'budgets' },
  { href: '/reports', icon: FileBarChart, labelKey: 'reports' },
  { href: '/tax', icon: Receipt, labelKey: 'tax' },
  { href: '/credit-cards', icon: CreditCard, labelKey: 'creditCards' },
  { href: '/settings', icon: Settings, labelKey: 'settings' },
] as const;

export function Sidebar() {
  const t = useTranslations('nav');
  const tAuth = useTranslations('auth');
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isAuthenticated } = useUser();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

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
        {isAuthenticated && user && (
          <div className="mb-4 rounded-lg bg-slate-800/50 p-3">
            <p className="truncate text-sm font-medium text-slate-300">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
            <p className="mt-2 text-xs text-slate-500">{t('baseCurrency')}: {user.baseCurrency}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <LanguageSwitcher compact />
          <ThemeToggle />
          {isAuthenticated && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              className="h-9 w-9 text-slate-400 hover:bg-slate-800 hover:text-white"
              title={tAuth('logout')}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
