'use client';

import { useSyncExternalStore } from 'react';
import { Sidebar } from './sidebar';
import { BottomNav } from './bottom-nav';
import { useUIStore } from '@/lib/store';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: React.ReactNode;
  /** Short, stable-per-deploy id shown in the sidebar/more-menu footer so a
   *  reinstalled or freshly-reloaded PWA is visibly on a new build. */
  buildVersion: string;
}

function useIsMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function AppShell({ children, buildVersion }: AppShellProps) {
  const { sidebarCollapsed } = useUIStore();
  const mounted = useIsMounted();
  if (!mounted) return null;

  return (
    <div className="min-h-dvh bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <Sidebar buildVersion={buildVersion} />
      <BottomNav buildVersion={buildVersion} />
      <main className={cn('pb-safe-nav transition-[margin] duration-200 ease-out md:pb-0', sidebarCollapsed ? 'md:ml-16' : 'md:ml-64')}>{children}</main>
    </div>
  );
}
