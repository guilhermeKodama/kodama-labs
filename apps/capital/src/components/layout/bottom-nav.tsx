'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  User,
  ArrowLeftRight,
  FileBarChart,
  MoreHorizontal,
  PiggyBank,
  Settings,
  Repeat,
  Target,
  Receipt,
  CreditCard,
  LogOut,
  Flame,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useUser } from '@/lib/user-context';

const mainNavItems = [
  { href: '/dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { href: '/businesses', icon: Building2, labelKey: 'businesses' },
  { href: '/personal', icon: User, labelKey: 'personal' },
  { href: '/transfers', icon: ArrowLeftRight, labelKey: 'transfers' },
] as const;

const moreNavItems = [
  { href: '/recurring', icon: Repeat, labelKey: 'recurring' },
  { href: '/investments', icon: PiggyBank, labelKey: 'investments' },
  { href: '/fire', icon: Flame, labelKey: 'fire' },
  { href: '/budgets', icon: Target, labelKey: 'budgets' },
  { href: '/reports', icon: FileBarChart, labelKey: 'reports' },
  { href: '/tax', icon: Receipt, labelKey: 'tax' },
  { href: '/credit-cards', icon: CreditCard, labelKey: 'creditCards' },
  { href: '/settings', icon: Settings, labelKey: 'settings' },
] as const;

export function BottomNav() {
  const t = useTranslations('nav');
  const tAuth = useTranslations('auth');
  const pathname = usePathname();
  const router = useRouter();
  const { logout, isAuthenticated } = useUser();

  const isMoreActive = moreNavItems.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

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
            {isAuthenticated && (
              <>
                <DropdownMenuSeparator className="bg-slate-700" />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="flex cursor-pointer items-center gap-2 text-red-400 focus:text-red-400"
                >
                  <LogOut className="h-4 w-4" />
                  {tAuth('logout')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
