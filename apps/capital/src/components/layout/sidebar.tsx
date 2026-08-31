'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  TrendingUp,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/language-switcher';
import { cn } from '@/lib/utils';
import { useUser } from '@/lib/user-context';
import { useUIStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { NAV_ITEMS, isNavItemActive } from './nav-items';

export function Sidebar() {
  const t = useTranslations('nav');
  const tAuth = useTranslations('auth');
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isAuthenticated } = useUser();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-slate-800 bg-slate-950 transition-[width] duration-200 ease-out md:flex',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo + collapse toggle */}
      <div
        className={cn(
          'flex h-16 items-center border-b border-slate-800',
          sidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-6'
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500">
          <TrendingUp className="h-5 w-5 text-white" />
        </div>
        {!sidebarCollapsed && (
          <>
            <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-xl font-bold text-transparent">
              Capital
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="ml-auto h-7 w-7 text-slate-500 hover:bg-slate-800 hover:text-white"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Collapse toggle when collapsed (placed at top below logo) */}
      {sidebarCollapsed && (
        <div className="flex justify-center border-b border-slate-800 py-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="h-7 w-7 text-slate-500 hover:bg-slate-800 hover:text-white"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Navigation */}
      <nav className={cn('flex-1 space-y-1', sidebarCollapsed ? 'p-2' : 'p-4')}>
        {NAV_ITEMS.map((item) => {
          const isActive = isNavItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={sidebarCollapsed ? t(item.labelKey) : undefined}
              className={cn(
                'flex items-center rounded-lg text-sm font-medium transition-colors',
                sidebarCollapsed
                  ? 'h-10 w-10 justify-center'
                  : 'gap-3 px-3 py-2.5',
                isActive
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!sidebarCollapsed && <span className="truncate">{t(item.labelKey)}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className={cn('border-t border-slate-800', sidebarCollapsed ? 'p-2' : 'p-4')}>
        {/* User info (only when expanded) */}
        {!sidebarCollapsed && isAuthenticated && user && (
          <div className="mb-4 rounded-lg bg-slate-800/50 p-3">
            <p className="truncate text-sm font-medium text-slate-300">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
            <p className="mt-2 text-xs text-slate-500">
              {t('baseCurrency')}: {user.baseCurrency}
            </p>
          </div>
        )}

        {/* Actions */}
        <div
          className={cn(
            'flex items-center',
            sidebarCollapsed ? 'flex-col gap-1' : 'justify-between'
          )}
        >
          {/* Language switcher hidden when collapsed — its pill is wider than the column. */}
          {!sidebarCollapsed && <LanguageSwitcher compact />}
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
