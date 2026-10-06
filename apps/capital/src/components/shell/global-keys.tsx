"use client";

import { Suspense } from "react";
import { useLedgerOverlays } from "@/components/ledger/overlay-state";
import { usePathname, useRouter } from "@/i18n/navigation";
import { createEntryTarget, settingsShortcutTarget } from "@/lib/shell/shortcuts";
import { useShellShortcut } from "@/lib/shell/use-shell-shortcut";
import { useOpenSettings } from "./user-menu";

/**
 * N and ⌘, on every signed-in page, Ajustes included (mounted once by
 * WorkspaceProviders, which both the (app) and (settings) layouts use).
 * N is bound only here: on Transações it opens the dialog over the view,
 * so the screen does not bind it again. ⌘K belongs to the palette, ⌘B to
 * the app shell (the sidebar only exists there) and ⌘Z to UndoBridge, all
 * through useShellShortcut and the SHELL_SHORTCUTS table.
 */
export function GlobalKeys() {
  return (
    <Suspense fallback={null}>
      <Bindings />
    </Suspense>
  );
}

function Bindings() {
  const pathname = usePathname();
  const router = useRouter();
  const ledger = useLedgerOverlays();
  const openSettings = useOpenSettings();
  useShellShortcut("create", () => {
    const target = createEntryTarget(pathname);
    if (target.kind === "param") ledger.openCreate();
    else router.push(target.href);
  });
  useShellShortcut("settings", () => {
    if (settingsShortcutTarget(pathname) === "open") openSettings();
  });
  return null;
}
