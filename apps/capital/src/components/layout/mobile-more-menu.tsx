'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useUser } from '@/lib/user-context';
import { MOBILE_MORE_ITEMS, isNavItemActive } from './nav-items';

interface MobileMoreMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildVersion: string;
}

/**
 * The bottom-nav "Mais" sheet: the 9 destinations that don't fit the
 * primary bar, plus the user/theme/language/logout controls the sidebar
 * hosts on desktop (there's no sidebar on mobile to put them in).
 */
export function MobileMoreMenu({ open, onOpenChange, buildVersion }: MobileMoreMenuProps) {
  const t = useTranslations('nav');
  const tAuth = useTranslations('auth');
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isAuthenticated } = useUser();

  const handleLogout = async () => {
    onOpenChange(false);
    await logout();
    router.push('/login');
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="pb-safe">
        <DrawerHeader className="text-left">
          <DrawerTitle>{t('moreMenuTitle')}</DrawerTitle>
        </DrawerHeader>

        <div className="px-4">
          {isAuthenticated && user && (
            <div className="mb-4 rounded-lg bg-muted/50 p-3">
              <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('baseCurrency')}: {user.baseCurrency}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground/70">v. {buildVersion.slice(0, 8)}</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {MOBILE_MORE_ITEMS.map((item) => {
              const isActive = isNavItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => onOpenChange(false)}
                  className={cn(
                    'flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl p-3 text-center transition-colors active:bg-muted',
                    isActive ? 'text-emerald-400' : 'text-foreground'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-10 items-center justify-center rounded-lg',
                      isActive ? 'bg-emerald-500/10' : 'bg-muted'
                    )}
                  >
                    <item.icon className="size-5" />
                  </span>
                  <span className="text-xs leading-tight">{t(item.labelKey)}</span>
                </Link>
              );
            })}
          </div>

          <Separator className="my-4" />

          <div className="flex items-center justify-between gap-2 pb-4">
            <LanguageSwitcher compact />
            <div className="flex items-center gap-1">
              <ThemeToggle />
              {isAuthenticated && (
                <button
                  type="button"
                  onClick={handleLogout}
                  title={tAuth('logout')}
                  aria-label={tAuth('logout')}
                  className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <LogOut className="size-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
