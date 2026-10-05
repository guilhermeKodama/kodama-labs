"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { isUnauthenticated, useLogout, useSession } from "@/lib/session";

const PUBLIC = ["/login", "/signup"];

export function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const logout = useLogout();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC.includes(pathname);
  const unauthenticated = session.isError && isUnauthenticated(session.error);

  useEffect(() => {
    if (isPublic || session.isPending) return;
    if (unauthenticated) {
      void logout.mutateAsync().finally(() => router.replace("/login"));
    }
  }, [isPublic, session.isPending, unauthenticated, logout, router]);

  if (isPublic) return children;
  if (session.isPending) {
    return <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">…</div>;
  }
  if (!session.data) {
    return <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">{session.error instanceof Error ? session.error.message : "…"}</div>;
  }
  return children;
}
