import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 18px outlined tag (entity, status). `mono` for codes and amounts. */
export function Badge({ children, mono, tone, className }: { children: ReactNode; mono?: boolean; tone?: "warn" | "neg"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] max-w-full items-center truncate rounded border border-stroke-2 px-1.5 text-[11px] text-fg-2",
        mono && "font-mono tabular-nums",
        tone === "warn" && "border-warn-soft text-warn-strong",
        tone === "neg" && "border-neg-soft text-neg",
        className,
      )}
    >
      {children}
    </span>
  );
}
