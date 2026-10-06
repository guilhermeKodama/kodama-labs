"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useShellShortcut } from "@/lib/shell/use-shell-shortcut";
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

  useShellShortcut("undo", () => void undoLast());
  return null;
}
