"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { OverlayScope, useOverlay } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { useReturnFocus } from "./dialog";
import { BACKDROP } from "./styles";

/**
 * Panel that rises from the bottom of a phone screen over the page: the
 * whole width, at most 85% of the height, 12px top corners, the same
 * backdrop as Dialog. Start it with <DialogHead>. Tapping the backdrop or
 * Esc closes it, and focus goes back to what opened it.
 */
export function BottomSheet({ open, onOpenChange, children, className }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode; className?: string }) {
  const overlayId = useOverlay(open);
  const returnFocus = useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={BACKDROP} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={returnFocus}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-3 overflow-y-auto rounded-t-[12px] border-t border-stroke-1 bg-panel px-[18px] pt-2 pb-[calc(18px+var(--safe-bottom))] text-fg-1 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-8",
            className,
          )}
        >
          <span aria-hidden className="mx-auto h-1 w-9 shrink-0 rounded-full bg-fill-1" />
          <OverlayScope id={overlayId}>{children}</OverlayScope>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
