import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Keyboard hint: mono 10px, 1px 4px padding, radius 4. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex items-center rounded-[4px] border border-stroke-2 px-1 py-px font-mono text-micro leading-none text-fg-3", className)}>
      {children}
    </kbd>
  );
}
