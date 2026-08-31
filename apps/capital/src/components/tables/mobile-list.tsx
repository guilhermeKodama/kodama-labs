'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared row-list primitives for the mobile card view of a data table.
 * Every table keeps its own bespoke desktop <Table>; below `md` it renders
 * this instead, CSS-switched (`hidden md:block` on the table, `md:hidden`
 * on the list) rather than swapped via JS — no hydration risk, and the
 * table's own render logic stays untouched.
 *
 * Modeled on the div-based row layout in recent-transactions.tsx (the
 * pattern that was already right): an icon chip, two lines of text that
 * truncate instead of wrapping, and a right-aligned amount column.
 */

interface MobileListProps {
  className?: string;
  children: ReactNode;
}

export function MobileList({ className, children }: MobileListProps) {
  return (
    <div className={cn('divide-y divide-border overflow-hidden rounded-lg border bg-card', className)}>
      {children}
    </div>
  );
}

interface MobileListItemProps {
  /** Icon chip or other fixed-size element in the leading position. */
  leading?: ReactNode;
  title: ReactNode;
  /** Inline content appended right after the title (e.g. an attachment badge). */
  titleExtra?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned primary value, typically a signed/colored amount. */
  trailing?: ReactNode;
  /** Right-aligned secondary line under `trailing` (e.g. an approx. base-currency amount, or a status badge). */
  trailingSub?: ReactNode;
  /** Row-actions trigger (e.g. the table's existing DropdownMenu), rendered after the trailing column. */
  actions?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function MobileListItem({
  leading,
  title,
  titleExtra,
  subtitle,
  trailing,
  trailingSub,
  actions,
  onClick,
  className,
}: MobileListItemProps) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors',
        onClick && 'active:bg-muted/50',
        className
      )}
    >
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
          <span className="truncate">{title}</span>
          {titleExtra}
        </p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {(trailing || trailingSub) && (
        <div className="shrink-0 text-right">
          {trailing && <div className="text-sm font-medium">{trailing}</div>}
          {trailingSub && <div className="text-xs text-muted-foreground">{trailingSub}</div>}
        </div>
      )}
      {actions && <div className="shrink-0">{actions}</div>}
    </Comp>
  );
}

export function MobileListEmpty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
