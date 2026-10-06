"use client";

import type { ReactNode } from "react";
import { LocaleSync } from "@/components/providers/locale-sync";
import { SessionGate } from "@/components/providers/session-gate";
import { ThemeSync } from "@/components/providers/theme-sync";
import { UndoBridge } from "@/lib/api/undo-bridge";
import { FormatProvider } from "@/lib/format/provider";
import { ShortcutProvider } from "@/lib/shortcuts/provider";
import { GlobalKeys } from "./global-keys";

/**
 * Everything a signed-in page needs, shared by the (app) and (settings)
 * layouts: keyboard shortcuts and the overlay stack, the user's number and
 * date formats, theme and language, N, ⌘, and ⌘Z, and the session gate.
 */
export function WorkspaceProviders({ children }: { children: ReactNode }) {
  return (
    <ShortcutProvider>
      <FormatProvider>
        <ThemeSync />
        <LocaleSync />
        <UndoBridge />
        <SessionGate>
          <GlobalKeys />
          {children}
        </SessionGate>
      </FormatProvider>
    </ShortcutProvider>
  );
}
