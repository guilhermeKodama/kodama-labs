import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Centered 12px tertiary message in place of rows ("Nenhum lançamento em set/2026…"). */
export function EmptyRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("border-t border-stroke-3 px-3 py-6 text-center text-[12px] text-fg-3 first:border-t-0", className)}>{children}</div>;
}
