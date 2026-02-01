'use client';

import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  Building2,
  User,
  ArrowLeftRight,
  Settings,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { href: '/businesses', icon: Building2, labelKey: 'businesses' },
  { href: '/personal', icon: User, labelKey: 'personal' },
  { href: '/transfers', icon: ArrowLeftRight, labelKey: 'transfers' },
  { href: '/settings', icon: Settings, labelKey: 'settings' },
] as const;

export function BottomNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur-sm lg:hidden">
      <div className="flex h-16 items-center justify-around">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-1 px-3 py-2 text-xs transition-colors',
                isActive
                  ? 'text-emerald-400'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="truncate">{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
