"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { BACKDROP } from "./styles";

/** Widths the mockup uses for dialogs. */
export type DialogWidth = 460 | 480 | 560 | 600 | 640 | 720;

/**
 * Centered dialog: chrome backdrop at 72%, 28px from the top, radius 12,
 * padding 18, 14px between blocks. Esc and the backdrop close it through
 * `onOpenChange(false)`. Start the body with <DialogHead>, which also
 * provides the accessible title.
 */
export function Dialog({
  open,
  onOpenChange,
  width = 560,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width?: DialogWidth;
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
            "fixed top-7 left-1/2 z-50 flex max-h-[calc(100dvh-56px)] max-w-[94vw] -translate-x-1/2 flex-col gap-3.5 overflow-y-auto rounded-[12px] border border-stroke-1 bg-editor p-[18px] text-fg-1 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0",
            className,
          )}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Title (15px semibold), optional description (12px tertiary) and ✕. Works in Dialog and Sheet. */
export function DialogHead({ title, desc, onClose = true }: { title: ReactNode; desc?: ReactNode; onClose?: boolean | (() => void) }) {
  const t = useTranslations("common");
  const close = (
    <button type="button" aria-label={t("close")} className="text-fg-3 outline-none hover:text-fg-1 focus-visible:text-fg-1" onClick={typeof onClose === "function" ? onClose : undefined}>
      ✕
    </button>
  );
  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <DialogPrimitive.Title className="text-[15px] font-semibold">{title}</DialogPrimitive.Title>
        {desc ? <DialogPrimitive.Description className="text-[12px] text-fg-3">{desc}</DialogPrimitive.Description> : null}
      </div>
      {onClose === false ? null : typeof onClose === "function" ? close : <DialogPrimitive.Close asChild>{close}</DialogPrimitive.Close>}
    </div>
  );
}

/** Action row at the bottom of a dialog or sheet. */
export function DialogFooter({ children, justify = "end", className }: { children: ReactNode; justify?: "end" | "between"; className?: string }) {
  return <div className={cn("flex items-center gap-1.5", justify === "end" ? "justify-end" : "justify-between", className)}>{children}</div>;
}
