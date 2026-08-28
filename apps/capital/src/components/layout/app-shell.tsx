'use client';

import { useState, useSyncExternalStore, useCallback } from 'react';
import { Sidebar } from './sidebar';
import { BottomNav } from './bottom-nav';
import { OnboardingDialog } from '@/components/onboarding/onboarding-dialog';
import { useSettingsStore, useUIStore } from '@/lib/store';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: React.ReactNode;
  /** Skip the centered max-width padding wrapper for pages that own their own layout (e.g. the chat, which needs an edge-to-edge, internally-scrolling column). */
  fullBleed?: boolean;
}

// Custom hook to track client-side mounting without setState in effect
function useIsMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function AppShell({ children, fullBleed = false }: AppShellProps) {
  const { isInitialized } = useSettingsStore();
  const { sidebarCollapsed } = useUIStore();
  const mounted = useIsMounted();
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  // Derive showOnboarding from state instead of using useEffect
  const showOnboarding = mounted && !isInitialized && !onboardingDismissed;

  const handleOnboardingComplete = useCallback(() => {
    setOnboardingDismissed(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <Sidebar />
      <BottomNav />

      {/* Main content — margin tracks sidebar width on desktop. */}
      <main
        className={cn(
          'pb-20 transition-[margin] duration-200 ease-out lg:pb-0',
          sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'
        )}
      >
        {fullBleed ? (
          <div className="h-[calc(100dvh-4rem)] lg:h-dvh">{children}</div>
        ) : (
          <div
            className={cn(
              'mx-auto p-4 sm:p-6 lg:p-8',
              sidebarCollapsed ? 'max-w-[1800px]' : 'max-w-7xl'
            )}
          >
            {children}
          </div>
        )}
      </main>

      {/* Onboarding dialog */}
      <OnboardingDialog
        open={showOnboarding}
        onComplete={handleOnboardingComplete}
      />
    </div>
  );
}
