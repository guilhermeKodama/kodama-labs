"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useInitializeData } from "@/hooks/use-initialize-data";
import { useUser } from "@/lib/user-context";
import { usePathname, useRouter } from "@/i18n/navigation";
import { refreshAllData } from "@/lib/refresh-data";
import { useSettingsStore } from "@/lib/store/settings-store";

interface DataInitializerProps {
  children: ReactNode;
}

// Must match the middleware's publicRoutes (src/middleware.ts) — the two lists
// split one responsibility: the middleware can only see that a capital_session
// cookie EXISTS (edge runtime, no DB), so a stale/expired cookie sails past it.
// Whether the session is actually VALID is only known here, after auth/me
// resolves — so this component owns the "cookie present but session dead" case.
const PUBLIC_ROUTES = ["/", "/login", "/signup"];

function LoadingScreen() {
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

export function DataInitializer({ children }: DataInitializerProps) {
  const { isLoading: userLoading, isAuthenticated, error: userError, logout } = useUser();
  const { isLoading: dataLoading, isInitialized } = useInitializeData();
  const pathname = usePathname();
  const router = useRouter();

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

  // Unauthenticated on a protected route: clear the dead cookie (otherwise the
  // middleware keeps letting the browser back in) and send them to login.
  // Without this, a stale session rendered an empty dashboard with the
  // onboarding wizard looping on 401s.
  useEffect(() => {
    if (!userLoading && !isAuthenticated && !isPublicRoute) {
      void logout().finally(() => router.replace("/login"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLoading, isAuthenticated, isPublicRoute]);

  // Silent revalidation on navigation: refreshAllData's own staleness gate
  // keeps this from firing on every route inside a single stale window.
  // Data already in the stores stays on screen the whole time — this never
  // shows a loading state. Deliberately keyed on [pathname] alone (reading
  // isInitialized from the store rather than depending on it) — the effect
  // should re-run for exactly one reason, an actual route change, not
  // whenever the initial-load flag happens to flip too.
  const isFirstPathname = useRef(true);
  useEffect(() => {
    if (isFirstPathname.current) {
      isFirstPathname.current = false;
      return;
    }
    if (useSettingsStore.getState().isInitialized) void refreshAllData();
  }, [pathname]);

  // Resume from background — an iOS PWA can sit paused for hours without a
  // navigation ever happening, which is the exact case that was reported as
  // "data never refreshes." This is the other half of that fix.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && useSettingsStore.getState().isInitialized) {
        void refreshAllData();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  if (!isAuthenticated && !userLoading) {
    // Public pages render normally for visitors; protected pages show the
    // loading screen while the redirect above kicks in — never the app shell.
    return isPublicRoute ? <>{children}</> : <LoadingScreen />;
  }

  const isLoading = userLoading || (dataLoading && !isInitialized);

  if (isLoading) {
    return <LoadingScreen />;
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
