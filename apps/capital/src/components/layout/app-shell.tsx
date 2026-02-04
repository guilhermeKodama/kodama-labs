'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from './sidebar';
import { BottomNav } from './bottom-nav';
import { OnboardingDialog } from '@/components/onboarding/onboarding-dialog';
import { useSettingsStore } from '@/lib/store';
import { useRecurringGenerator } from '@/lib/hooks';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { isInitialized } = useSettingsStore();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Auto-generate recurring transactions on app load
  useRecurringGenerator();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isInitialized) {
      setShowOnboarding(true);
    }
  }, [mounted, isInitialized]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

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
