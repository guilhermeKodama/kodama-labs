"use client";

import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { CommandMenu } from "@/components/shell/command";
import { usePathname } from "@/i18n/navigation";
import { rememberAppUrl, sessionStore } from "@/lib/shell/last-app-url";
import { useShellShortcut } from "@/lib/shell/use-shell-shortcut";
import { GlobalOverlays } from "./global-overlays";
import { Sidebar, SidebarDrawer, toggleSidebar } from "./sidebar";
import { StatusBarStrip } from "./status-bar-strip";

/**
 * The signed-in app around every screen of the (app) layout. It stays
 * mounted while the user moves between screens: the sidebar (a drawer
 * below md), the ⌘K palette, the app-wide overlays and the global keys.
 * Screens render <Page> into the main column.
 */
export function AppShell({ children }: { children: ReactNode }) {
  useShellShortcuts();
  useRememberAppUrl();

  return (
    <>
      {/* Clear of the status bar and the home indicator in the installed app (globals.css, safe areas). */}
      <div className="flex h-dvh bg-editor px-safe pt-safe pb-safe text-fg-1 standalone:h-screen">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
      <StatusBarStrip />
      <SidebarDrawer />
      <CommandMenu />
      <GlobalOverlays />
    </>
  );
}

/** ⌘B (lib/shell/shortcuts.ts); N and ⌘, are bound by GlobalKeys (also in Ajustes). */
function useShellShortcuts() {
  useShellShortcut("sidebar", toggleSidebar);
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
