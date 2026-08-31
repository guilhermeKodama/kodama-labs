'use client';

import { useUIStore } from '@/lib/store';
import { cn } from '@/lib/utils';

/**
 * Centered max-width padding wrapper shared by every non-full-bleed screen.
 * Was previously duplicated inline in AppShell per page; now the split
 * layout groups let only the assistant (see assistant/layout.tsx) opt out.
 */
export default function PaddedLayout({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed } = useUIStore();

  return (
    <div
      className={cn(
        'mx-auto p-4 sm:p-6 lg:p-8',
        sidebarCollapsed ? 'max-w-[1800px]' : 'max-w-7xl'
      )}
    >
      {children}
    </div>
  );
}
