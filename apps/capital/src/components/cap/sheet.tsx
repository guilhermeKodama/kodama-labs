"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { BACKDROP } from "./styles";

/**
 * Right-side panel over the page (Editar transação, holding detail): full
 * height, 440px (320 for narrow details), padding 18, 14px gap, same
 * backdrop as Dialog. Start it with <DialogHead>.
 */
export function Sheet({
  open,
  onOpenChange,
  width = 440,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width?: 440 | 320;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={BACKDROP} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          style={{ width }}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex max-w-full flex-col gap-3.5 overflow-y-auto border-l border-stroke-1 bg-editor p-[18px] text-fg-1 outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right-4 data-[state=open]:fade-in-0",
            className,
          )}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
