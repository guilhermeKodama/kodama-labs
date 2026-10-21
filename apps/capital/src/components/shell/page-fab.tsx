"use client";

import { useEffect, useState, type RefObject } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** How long after the last scroll the label comes back. */
const SETTLE_MS = 600;

/**
 * Lifts the bottom toasts over the floating button while it is up (56px
 * button + 8px gap), on the widths that show it. ui/sonner.tsx adds
 * --fab-clearance to its bottom offset.
 */
const TOASTS_ABOVE_FAB = "@media (max-width: 767.98px) { :root { --fab-clearance: 64px; } }";

/** A text field has the focus outside a dialog: the on-screen keyboard is up and the button would float over it. */
function typingOnPage(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el.closest('[role="dialog"]')) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(el.type);
}

/**
 * The screen's primary action as a floating button, on a phone (below md):
 * bottom right, clear of the home indicator, with the action's name next to
 * a +. While the body scrolls it shrinks to the + and grows back once the
 * scroll stops; it steps aside while the keyboard is up.
 */
export function PageFab({ label, onSelect, scroller }: { label: string; onSelect: () => void; scroller: RefObject<HTMLElement | null> }) {
  const [scrolling, setScrolling] = useState(false);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      setScrolling(true);
      clearTimeout(timer);
      timer = setTimeout(() => setScrolling(false), SETTLE_MS);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, [scroller]);

  useEffect(() => {
    const update = () => setTyping(typingOnPage());
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);

  if (typing) return null;
  // The labels carry their "+" for the desktop buttons ("+ Nova transação"); here the + is the icon.
  const text = label.replace(/^\+\s*/, "");
  return (
    <>
      <style>{TOASTS_ABOVE_FAB}</style>
      <button
        type="button"
        onClick={onSelect}
        data-fab
        className={cn(
          "fixed right-[calc(1rem+var(--safe-right))] bottom-[calc(1rem+var(--safe-bottom)-var(--screen-below-viewport,0px))] z-30 inline-flex h-14 min-w-14 items-center justify-center gap-2 rounded-[16px] bg-brand text-button font-semibold text-on-brand shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40 md:hidden",
          scrolling ? "px-4" : "pr-5 pl-4",
        )}
      >
        <Plus aria-hidden className="size-6 shrink-0" />
        <span className={cn("whitespace-nowrap", scrolling && "sr-only")}>{text}</span>
      </button>
    </>
  );
}
