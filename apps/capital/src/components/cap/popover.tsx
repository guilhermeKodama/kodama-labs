"use client";

import type { ReactNode } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { OverlayScope, useOverlayRoot } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { FLOATING } from "./styles";

/**
 * Anchored panel (filter editors, period picker, view options): radius 10,
 * padding 10, 8px gap, 260px wide by default. Closes on outside click and
 * Esc. `trigger` becomes the Radix trigger (a <button> or Btn). Open or
 * closed by itself unless `open` is passed; an overlay while open.
 */
export function Popover({
  trigger,
  children,
  align = "start",
  side = "bottom",
  width = 260,
  open,
  onOpenChange,
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  width?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const root = useOverlayRoot({ open, onOpenChange });
  return (
    <PopoverPrimitive.Root open={root.open} onOpenChange={root.onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          style={{ width }}
          className={cn(
            FLOATING,
            "flex max-h-[var(--radix-popover-content-available-height)] flex-col gap-2 overflow-y-auto rounded-[10px] p-2.5 text-body",
            className,
          )}
        >
          <OverlayScope id={root.overlayId}>{children}</OverlayScope>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** Wrap a button inside the popover that should also close it. */
export function PopoverClose({ children }: { children: ReactNode }) {
  return <PopoverPrimitive.Close asChild>{children}</PopoverPrimitive.Close>;
}
