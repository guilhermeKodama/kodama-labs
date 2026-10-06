"use client";

import { useEffect } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { openAssistant } from "@/lib/shell/assistant-bridge";

/**
 * Overlays any screen can open through the URL, mounted once in the (app)
 * layout. Screens keep their own (Transações: components/ledger/overlays.tsx).
 *
 * - `?assistant=1` (the old /assistant page redirects here): opens the
 *   assistant in ⌘K, then leaves the URL.
 *
 * Add app-wide overlays here rather than in a screen.
 */
export function GlobalOverlays() {
  const [assistant, setAssistant] = useQueryState("assistant", parseAsString);

  useEffect(() => {
    if (assistant === null) return;
    openAssistant();
    void setAssistant(null);
  }, [assistant, setAssistant]);

  return null;
}
