import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Rounded toggle chip for filter groups and tab rows ("Todas · 57", "Criar", "Editar"). */
export function Pill({
  active,
  size = "md",
  hint,
  className,
  children,
  ...props
}: Omit<ComponentProps<"button">, "type"> & {
  active?: boolean;
  size?: "sm" | "md";
  /** Trailing muted text, e.g. a shortcut. */
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...props}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border text-button whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40 disabled:cursor-not-allowed disabled:opacity-40",
        size === "md" ? "h-6 px-2.5" : "h-5 px-2 text-label",
        active ? "border-stroke-1 bg-fill-3 font-medium text-fg-1" : "border-stroke-2 text-fg-2 hover:bg-fill-4",
        className,
      )}
    >
      {children}
      {hint ? <span className="font-mono text-hint text-fg-4">{hint}</span> : null}
    </button>
  );
}
