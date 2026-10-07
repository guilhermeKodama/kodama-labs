import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Bordered section with a 36px header (title left, `trailing` right). */
export function Panel({
  title,
  trailing,
  children,
  pad = true,
  className,
}: {
  title: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  /** 12px body padding; off for tables that run edge to edge. */
  pad?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-[8px] border border-stroke-3", className)}>
      <header className="flex h-9 items-center gap-2 border-b border-stroke-3 px-3 text-body font-medium">
        <span className="min-w-0 truncate">{title}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">{trailing}</span>
      </header>
      <div className={pad ? "p-3" : undefined}>{children}</div>
    </section>
  );
}
