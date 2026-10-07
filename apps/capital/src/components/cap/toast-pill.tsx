"use client";

import type { ReactNode } from "react";
import type { ToastClassnames } from "sonner";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const PILL = "flex items-center gap-3.5 rounded-[8px] bg-fg-1 px-3.5 py-[9px] text-body text-editor shadow-lg";
const ACTION = "cursor-pointer font-semibold whitespace-nowrap underline outline-none focus-visible:ring-2 focus-visible:ring-editor/40";

/**
 * Sonner classes for the mockup toast: an inverted pill at the bottom
 * center, the action ("Desfazer") as underlined bold text. Used by the
 * <Toaster> in src/components/ui/sonner.tsx, so every toast() looks like this.
 */
export const TOAST_CLASS_NAMES: ToastClassnames = {
  toast: cn(PILL, "inset-x-0 mx-auto w-fit max-w-[calc(100vw-32px)]"),
  content: "min-w-0",
  title: "leading-snug",
  description: "text-label text-fg-4",
  actionButton: cn(ACTION, "bg-transparent"),
  cancelButton: "cursor-pointer whitespace-nowrap text-fg-4 underline",
  icon: "hidden",
};

/** The same pill rendered in place (e.g. inside a panel), with an optional undo action. */
export function ToastPill({ children, onUndo, undoLabel, className }: { children: ReactNode; onUndo?: () => void; undoLabel?: ReactNode; className?: string }) {
  const t = useTranslations("common");
  return (
    <div role="status" className={cn(PILL, "w-fit whitespace-nowrap", className)}>
      <span className="min-w-0 truncate">{children}</span>
      {onUndo ? (
        <button type="button" onClick={onUndo} className={ACTION}>
          {undoLabel ?? t("undo")}
        </button>
      ) : null}
    </div>
  );
}
