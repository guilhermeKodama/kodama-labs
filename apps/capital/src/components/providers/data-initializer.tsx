"use client";

import { type ReactNode } from "react";
import { useInitializeData } from "@/hooks/use-initialize-data";
import { useUser } from "@/lib/user-context";

interface DataInitializerProps {
  children: ReactNode;
}

export function DataInitializer({ children }: DataInitializerProps) {
  const { isLoading: userLoading, isAuthenticated, error: userError } = useUser();
  const { isLoading: dataLoading, isInitialized } = useInitializeData();

  // Don't show loading if not authenticated - middleware will redirect
  if (!isAuthenticated && !userLoading) {
    return <>{children}</>;
  }

  const isLoading = userLoading || (dataLoading && !isInitialized);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="h-12 w-12 rounded-full border-4 border-emerald-500/30" />
            <div className="absolute inset-0 h-12 w-12 animate-spin rounded-full border-4 border-transparent border-t-emerald-500" />
          </div>
          <p className="text-sm text-neutral-400">Loading Capital...</p>
        </div>
      </div>
    );
  }

  if (userError && isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="rounded-full bg-red-500/10 p-4">
            <svg
              className="h-8 w-8 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-medium text-neutral-100">
              Failed to initialize
            </h2>
            <p className="mt-1 text-sm text-neutral-400">{userError}</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
