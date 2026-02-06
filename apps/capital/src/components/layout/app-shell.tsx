'use client';

import { useState, useSyncExternalStore, useCallback } from 'react';
import { Sidebar } from './sidebar';
import { BottomNav } from './bottom-nav';
import { OnboardingDialog } from '@/components/onboarding/onboarding-dialog';
import { useSettingsStore } from '@/lib/store';

interface AppShellProps {
  children: React.ReactNode;
}

// Custom hook to track client-side mounting without setState in effect
function useIsMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function AppShell({ children }: AppShellProps) {
  const { isInitialized } = useSettingsStore();
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

      {/* Main content */}
      <main className="pb-20 lg:ml-64 lg:pb-0">
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>

      {/* Onboarding dialog */}
      <OnboardingDialog
        open={showOnboarding}
        onComplete={handleOnboardingComplete}
      />
    </div>
  );
}
