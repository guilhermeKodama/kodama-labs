import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type BtnProps = Omit<ComponentProps<"button">, "type"> & {
  /** Filled with the primary ink (Salvar, Aplicar, Excluir in confirmations). */
  primary?: boolean;
  /** Dashed outline (adders like "+ Nova regra"). */
  dashed?: boolean;
  /** No border, secondary text (Cancelar, row-level actions). */
  ghost?: boolean;
  /** Negative text, for destructive ghost/outline buttons. */
  danger?: boolean;
  /** Square 26px button for a single glyph (‹ › ⋯). */
  icon?: boolean;
  type?: "button" | "submit" | "reset";
};

/** The mockup button: 26px, radius 6, 12px/500. Forwards props, so it works as a Radix trigger. */
export function Btn({ primary, dashed, ghost, danger, icon, type = "button", className, ...props }: BtnProps) {
  return (
    <button
      type={type}
      {...props}
      className={cn(
        "inline-flex h-[26px] shrink-0 items-center justify-center gap-1.5 rounded-[6px] border text-[12px] font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40 disabled:cursor-not-allowed disabled:opacity-40",
        icon ? "w-[26px] px-0" : "px-2.5",
        primary && "border-fg-1 bg-fg-1 text-editor hover:bg-fg-1/90",
        !primary && !ghost && "border-stroke-1 text-fg-1 hover:bg-fill-4 data-[state=open]:bg-fill-3",
        dashed && "border-dashed",
        ghost && "border-transparent text-fg-2 hover:bg-fill-3 data-[state=open]:bg-fill-3",
        danger && !primary && "text-neg",
        className,
      )}
    />
  );
}
