"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useShortcut } from "@/lib/shortcuts/provider";
import { configureUndo, undoLast } from "./undo";
import { useErrorMessage } from "./use-app-mutation";

/**
 * Connects undo.ts to the app: the query client to refresh after an undo,
 * localized toast strings, and ⌘Z (global scope, so not while typing or
 * with an overlay open). Mounted once in the signed-in layout.
 */
export function UndoBridge() {
  const queryClient = useQueryClient();
  const t = useTranslations("common");
  const errorText = useErrorMessage();

  useEffect(() => {
    configureUndo({ queryClient, label: (key) => t(key), errorText });
    return () => configureUndo(null);
  }, [queryClient, t, errorText]);

  useShortcut("mod+z", () => void undoLast(), { scope: "global" });
  return null;
}
