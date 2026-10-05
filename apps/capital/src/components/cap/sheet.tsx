"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { OverlayScope, useOverlay } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { useReturnFocus } from "./dialog";
import { BACKDROP } from "./styles";

/**
 * Right-side panel over the page (Editar transação, holding detail): full
 * height, 440px (320 for narrow details), padding 18, 14px gap, same
 * backdrop as Dialog. Start it with <DialogHead>. An overlay while open
 * that gives focus back on close, like Dialog.
 */
export function Sheet({
  open,
  onOpenChange,
  width = 440,
  onCloseAutoFocus,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width?: 440 | 320;
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
  className?: string;
}) {
  const overlayId = useOverlay(open);
  const returnFocus = useReturnFocus(open, onCloseAutoFocus);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={BACKDROP} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={returnFocus}
          style={{ width }}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex max-w-full flex-col gap-3.5 overflow-y-auto border-l border-stroke-1 bg-editor p-[18px] text-fg-1 outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right-4 data-[state=open]:fade-in-0",
            className,
          )}
        >
          <OverlayScope id={overlayId}>{children}</OverlayScope>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
