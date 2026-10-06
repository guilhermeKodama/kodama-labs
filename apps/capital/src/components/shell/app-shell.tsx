"use client";

import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useLedgerOverlays } from "@/components/ledger/overlay-state";
import { CommandMenu } from "@/components/shell/command";
import { usePathname, useRouter } from "@/i18n/navigation";
import { rememberAppUrl, sessionStore } from "@/lib/shell/last-app-url";
import { createEntryTarget, SHELL_SHORTCUTS } from "@/lib/shell/shortcuts";
import { useShortcut } from "@/lib/shortcuts/provider";
import { GlobalOverlays } from "./global-overlays";
import { Sidebar, SidebarDrawer, toggleSidebar } from "./sidebar";
import { useOpenSettings } from "./user-menu";

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

/**
 * N, ⌘, and ⌘B (lib/shell/shortcuts.ts). ⌘K belongs to the palette
 * (mounted in Ajustes too) and ⌘Z to UndoBridge.
 */
function useShellShortcuts() {
  const pathname = usePathname();
  const router = useRouter();
  const ledger = useLedgerOverlays();
  const openSettings = useOpenSettings();
  const { create, settings, sidebar } = SHELL_SHORTCUTS;

  useShortcut(
    create.combo,
    () => {
      const target = createEntryTarget(pathname);
      if (target.kind === "param") ledger.openCreate();
      else router.push(target.href);
    },
    { scope: "global", allowInInputs: create.allowInInputs },
  );
  useShortcut(settings.combo, () => openSettings(), { scope: "global", allowInInputs: settings.allowInInputs });
  useShortcut(sidebar.combo, toggleSidebar, { scope: "global", allowInInputs: sidebar.allowInInputs });
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
