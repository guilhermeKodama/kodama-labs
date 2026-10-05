"use client";

import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { CommandMenu } from "@/components/shell/command";
import { usePathname } from "@/i18n/navigation";
import { rememberAppUrl, sessionStore } from "@/lib/shell/last-app-url";
import { useShortcut } from "@/lib/shortcuts/provider";
import { GlobalOverlays } from "./global-overlays";
import { Sidebar, SidebarDrawer, toggleSidebar } from "./sidebar";

/**
 * The signed-in app around every screen of the (app) layout. It stays
 * mounted while the user moves between screens: the sidebar (a drawer
 * below md), the ⌘K palette and the app-wide overlays. Screens render
 * <Page> into the main column.
 */
export function AppShell({ children }: { children: ReactNode }) {
  useShortcut("mod+b", () => toggleSidebar(), { scope: "global" });
  useRememberAppUrl();

  return (
    <>
      <div className="flex h-dvh bg-editor text-fg-1">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
      <SidebarDrawer />
      <CommandMenu />
      <GlobalOverlays />
    </>
  );
}

/** Keeps the current app URL for Ajustes' "← Voltar ao app" (lib/shell/last-app-url.ts). */
function useRememberAppUrl() {
  const pathname = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    const query = params.toString();
    rememberAppUrl(sessionStore(), query ? `${pathname}?${query}` : pathname);
  }, [pathname, params]);
}
