'use client';

import { useState, useSyncExternalStore, useCallback } from 'react';
import { Sidebar } from './sidebar';
import { BottomNav } from './bottom-nav';
import { OnboardingDialog } from '@/components/onboarding/onboarding-dialog';
import { useSettingsStore, useUIStore } from '@/lib/store';
import { useUser } from '@/lib/user-context';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: React.ReactNode;
  /** Short, stable-per-deploy id shown in the sidebar/more-menu footer so a
   *  reinstalled or freshly-reloaded PWA is visibly on a new build. */
  buildVersion: string;
}

// Custom hook to track client-side mounting without setState in effect
function useIsMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function AppShell({ children, buildVersion }: AppShellProps) {
  const { isInitialized } = useSettingsStore();
  const { sidebarCollapsed } = useUIStore();
  const { isAuthenticated } = useUser();
  const mounted = useIsMounted();
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  // Derive showOnboarding from state instead of using useEffect.
  // Gated on isAuthenticated: the wizard's job is first-time setup for a
  // LOGGED-IN user — for an invalid/expired session, isInitialized never
  // turns true (users.me 401s) and the wizard would loop forever against
  // an API that rejects every submit.
  const showOnboarding = mounted && isAuthenticated && !isInitialized && !onboardingDismissed;

  const handleOnboardingComplete = useCallback(() => {
    setOnboardingDismissed(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <Sidebar buildVersion={buildVersion} />
      <BottomNav buildVersion={buildVersion} />

      {/* Main content — margin tracks sidebar width on desktop. */}
      <main
        className={cn(
          'pb-safe-nav transition-[margin] duration-200 ease-out md:pb-0',
          sidebarCollapsed ? 'md:ml-16' : 'md:ml-64'
        )}
      >
        {children}
      </main>

      {/* Onboarding dialog */}
      <OnboardingDialog
        open={showOnboarding}
        onComplete={handleOnboardingComplete}
      />
    </div>
  );
}
