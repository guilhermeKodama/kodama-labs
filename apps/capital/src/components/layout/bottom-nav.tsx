'use client';

import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  Building2,
  User,
  ArrowLeftRight,
  FileBarChart,
  MoreHorizontal,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PiggyBank, Settings } from 'lucide-react';

const mainNavItems = [
  { href: '/dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { href: '/businesses', icon: Building2, labelKey: 'businesses' },
  { href: '/personal', icon: User, labelKey: 'personal' },
  { href: '/transfers', icon: ArrowLeftRight, labelKey: 'transfers' },
] as const;

const moreNavItems = [
  { href: '/investments', icon: PiggyBank, labelKey: 'investments' },
  { href: '/reports', icon: FileBarChart, labelKey: 'reports' },
  { href: '/settings', icon: Settings, labelKey: 'settings' },
] as const;

export function BottomNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const isMoreActive = moreNavItems.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur-sm lg:hidden">
      <div className="flex h-16 items-center justify-around">
        {mainNavItems.map((item) => {
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

        {/* More menu */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'flex flex-col items-center gap-1 px-3 py-2 text-xs transition-colors',
              isMoreActive
                ? 'text-emerald-400'
                : 'text-slate-400 hover:text-white'
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="truncate">More</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="mb-2 border-slate-700 bg-slate-900"
          >
            {moreNavItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <DropdownMenuItem key={item.href} asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2',
                      isActive
                        ? 'text-emerald-400'
                        : 'text-slate-300'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {t(item.labelKey)}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
