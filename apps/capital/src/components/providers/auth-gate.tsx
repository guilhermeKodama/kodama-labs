"use client";

import { useEffect, type ReactNode } from "react";
import { useUser } from "@/lib/user-context";
import { usePathname, useRouter } from "@/i18n/navigation";

// Must match the middleware's publicRoutes (src/middleware.ts). The
// middleware only sees that a capital_session cookie exists; whether the
// session is valid is only known once /api/v2/me answers, so this gate owns
// the "cookie present but session dead" case.
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

export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, logout } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

  // Unauthenticated on a protected route: clear the dead cookie (otherwise
  // the middleware keeps letting the browser back in) and go to login.
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublicRoute) {
      void logout().finally(() => router.replace("/login"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated, isPublicRoute]);

  if (isPublicRoute) return <>{children}</>;
  if (isLoading || !isAuthenticated) return <LoadingScreen />;
  return <>{children}</>;
}
