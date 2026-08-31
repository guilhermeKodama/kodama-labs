'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MoreHorizontal } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { MOBILE_PRIMARY_ITEMS, MOBILE_MORE_ITEMS, isNavItemActive } from './nav-items';
import { MobileMoreMenu } from './mobile-more-menu';

/**
 * Phone/tablet nav (<md): 4 primary destinations plus a "Mais" trigger that
 * opens a bottom sheet with the remaining 9 — see nav-items.ts for which
 * items land where and why. Replaces the old 5-item + dropdown "More" bar.
 */
export function BottomNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isMoreActive = MOBILE_MORE_ITEMS.some((item) => isNavItemActive(pathname, item.href));

  return (
    <>
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm md:hidden">
        <div className="grid h-16 grid-cols-5">
          {MOBILE_PRIMARY_ITEMS.map((item) => {
            const isActive = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 text-[11px] transition-colors',
                  isActive ? 'text-emerald-400' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <item.icon className="size-5" />
                <span className="truncate">{t(item.labelKey)}</span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              'flex flex-col items-center justify-center gap-1 text-[11px] transition-colors',
              isMoreActive ? 'text-emerald-400' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <MoreHorizontal className="size-5" />
            <span className="truncate">{t('more')}</span>
          </button>
        </div>
      </nav>

      <MobileMoreMenu open={moreOpen} onOpenChange={setMoreOpen} />
    </>
  );
}
