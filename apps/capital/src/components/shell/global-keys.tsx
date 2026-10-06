"use client";

import { Suspense } from "react";
import { useLedgerOverlays } from "@/components/ledger/overlay-state";
import { usePathname, useRouter } from "@/i18n/navigation";
import { createEntryTarget, settingsShortcutTarget, SHELL_SHORTCUTS } from "@/lib/shell/shortcuts";
import { useShortcut } from "@/lib/shortcuts/provider";
import { useOpenSettings } from "./user-menu";

/**
 * N and ⌘, on every signed-in page, Ajustes included (mounted once by
 * WorkspaceProviders, which both the (app) and (settings) layouts use).
 * ⌘K belongs to the palette, ⌘B to the app shell (the sidebar only exists
 * there) and ⌘Z to UndoBridge.
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
  const { create, settings } = SHELL_SHORTCUTS;

  useShortcut(
    create.combo,
    () => {
      const target = createEntryTarget(pathname);
      if (target.kind === "param") ledger.openCreate();
      else router.push(target.href);
    },
    { scope: "global", allowInInputs: create.allowInInputs },
  );
  useShortcut(
    settings.combo,
    () => {
      if (settingsShortcutTarget(pathname) === "open") openSettings();
    },
    { scope: "global", allowInInputs: settings.allowInInputs },
  );
  return null;
}
