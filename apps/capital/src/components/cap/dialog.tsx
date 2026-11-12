"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { OverlayScope, useOverlay } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { BACKDROP } from "./styles";

/** Widths the mockup uses for dialogs. */
export type DialogWidth = 460 | 480 | 560 | 600 | 640 | 720;

/**
 * The phone (below md) form of the action row at the bottom of a dialog or
 * sheet: it sticks to the bottom of the screen, over the scrolling body,
 * clear of the home indicator. The negative margins cancel the dialog's
 * own bottom padding so the row reaches the screen's edge.
 */
export const DIALOG_FOOTER_PHONE =
  "max-md:sticky max-md:bottom-[calc(-18px-var(--safe-bottom))] max-md:-mx-[18px] max-md:-mb-[calc(18px+var(--safe-bottom))] max-md:mt-auto max-md:border-t max-md:border-stroke-2 max-md:bg-panel max-md:px-[18px] max-md:pt-3 max-md:pb-[calc(12px+var(--safe-bottom))]";

/**
 * Centered dialog: chrome backdrop at 72%, 28px from the top, radius 12,
 * padding 18, 14px between blocks. On a phone (below md) it takes the whole
 * screen, as iOS and Android show a form: clear of the status bar and the
 * home indicator, scrolling inside, its action row stuck to the bottom. Esc and the backdrop close it through
 * `onOpenChange(false)`. Start the body with <DialogHead>, which also
 * provides the accessible title. While open it is an overlay: app
 * shortcuts pause, and useShortcut inside it (⌘↵) is scoped to it.
 * Closing focuses again what had focus when it opened (useReturnFocus).
 */
export function Dialog({
  open,
  onOpenChange,
  width = 560,
  onOpenAutoFocus,
  onCloseAutoFocus,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width?: DialogWidth;
  /** Runs as the dialog opens; call `event.preventDefault()` and focus something else than the first control. */
  onOpenAutoFocus?: (event: Event) => void;
  /** Runs as the dialog closes; call `event.preventDefault()` and focus something else. */
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
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={returnFocus}
          style={{ width }}
          className={cn(
            "fixed top-[calc(1.75rem+var(--safe-top))] left-1/2 z-50 flex max-h-[calc(100dvh-56px-var(--safe-top)-var(--safe-bottom))] max-w-[94vw] -translate-x-1/2 flex-col gap-3.5 overflow-y-auto rounded-[12px] border border-stroke-1 bg-panel p-[18px] text-fg-1 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-h-none max-md:w-full! max-md:max-w-none max-md:translate-x-0 max-md:overflow-x-hidden max-md:rounded-none max-md:border-0 max-md:pt-[calc(18px+var(--safe-top))] max-md:pb-[calc(18px+var(--safe-bottom))] max-md:standalone:h-screen",
            className,
          )}
        >
          <OverlayScope id={overlayId}>{children}</OverlayScope>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Close-focus handler for Dialog and Sheet. Radix gives focus back to its
 * Trigger, but these are opened from code (N, a row, a menu item) and have
 * none, so focus would drop to <body>. This remembers what had focus when
 * `open` turned true and focuses it again, unless `onCloseAutoFocus` took
 * care of it or that element is gone (e.g. it was in a closed popover).
 */
export function useReturnFocus(open: boolean, onCloseAutoFocus?: (event: Event) => void): (event: Event) => void {
  const previous = useRef<HTMLElement | null>(null);
  // Layout effect: Radix moves focus into the content in a later passive effect.
  useLayoutEffect(() => {
    if (open) previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);
  return (event) => {
    onCloseAutoFocus?.(event);
    const target = previous.current;
    previous.current = null;
    if (event.defaultPrevented || !target?.isConnected || target === document.body) return;
    event.preventDefault();
    target.focus();
  };
}

/**
 * Title (15px semibold), optional description (12px tertiary) and ✕. Works in Dialog and Sheet.
 * On a phone the title is a size up and ✕ is a 44px button with a 24px icon.
 */
export function DialogHead({ title, desc, onClose = true }: { title: ReactNode; desc?: ReactNode; onClose?: boolean | (() => void) }) {
  const t = useTranslations("common");
  const close = (
    <button
      type="button"
      aria-label={t("close")}
      className="inline-flex shrink-0 items-center justify-center text-fg-3 outline-none hover:text-fg-1 focus-visible:text-fg-1 max-md:-mt-2.5 max-md:-mr-2.5 max-md:size-11 max-md:text-fg-2"
      onClick={typeof onClose === "function" ? onClose : undefined}
    >
      <span aria-hidden className="max-md:hidden">
        ✕
      </span>
      <X aria-hidden className="hidden size-6 max-md:block" strokeWidth={1.75} />
    </button>
  );
  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <DialogPrimitive.Title className="font-title text-title font-medium max-md:text-heading">{title}</DialogPrimitive.Title>
        {desc ? <DialogPrimitive.Description className="text-body-sm text-fg-3">{desc}</DialogPrimitive.Description> : null}
      </div>
      {onClose === false ? null : typeof onClose === "function" ? close : <DialogPrimitive.Close asChild>{close}</DialogPrimitive.Close>}
    </div>
  );
}

/** Action row at the bottom of a dialog or sheet. */
export function DialogFooter({ children, justify = "end", className }: { children: ReactNode; justify?: "end" | "between"; className?: string }) {
  return <div className={cn("flex items-center gap-1.5", justify === "end" ? "justify-end" : "justify-between", DIALOG_FOOTER_PHONE, className)}>{children}</div>;
}
