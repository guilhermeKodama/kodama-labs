"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { formatCombo, isMacPlatform, parseCombo } from "./combo";
import type { ShortcutScope } from "./resolve";
import { createShortcutStore, type ShortcutHandler, type ShortcutStore } from "./store";

const StoreContext = createContext<ShortcutStore | null>(null);
const OverlayContext = createContext<string | null>(null);

/**
 * App-wide keyboard shortcuts and the overlay stack. One keydown listener
 * on window dispatches to the registered shortcut with the highest scope
 * (store.ts, resolve.ts). Mount once, above everything that uses
 * useShortcut or useOverlay.
 *
 * An Esc pressed while an overlay is open belongs to the overlay stack: it
 * closes the top overlay and stops on <html>, after Radix's own document
 * listeners. Page-level keydown listeners (a screen's "Esc leaves the
 * page") never see it, even though Radix has already unmounted the layer
 * by the time they would run. Nor do React onKeyDown handlers inside the
 * overlay (React listens on the document): to act on Esc in a Radix
 * overlay, use its content's onEscapeKeyDown.
 */
export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createShortcutStore);
  useEffect(() => {
    const isMac = isMacPlatform(navigator);
    const root = document.documentElement;
    const onCapture = (event: KeyboardEvent) => {
      store.claimEscape(event);
    };
    const onRootCapture = (event: KeyboardEvent) => {
      if (store.handleOverlayEscape(event, isMac)) event.stopPropagation();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      store.handleKeyDown(event, isMac);
    };
    window.addEventListener("keydown", onCapture, true);
    root.addEventListener("keydown", onRootCapture, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onCapture, true);
      root.removeEventListener("keydown", onRootCapture, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [store]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export interface ShortcutOptions {
  /** Defaults to "overlay" inside an overlay, "screen" elsewhere. Shell shortcuts pass "global". */
  scope?: ShortcutScope;
  enabled?: boolean;
  /** Also fire with focus in a text field (⌘↵ to save a form). */
  allowInInputs?: boolean;
  /** Fire again while the key is held. Defaults to true for arrow keys only. */
  allowRepeat?: boolean;
}

/**
 * Binds one or more combos ("mod+k", "n", "mod+enter") while the component
 * is mounted. The handler can change on every render; return false from it
 * to pass the key on.
 */
export function useShortcut(combo: string | readonly string[], handler: ShortcutHandler, options: ShortcutOptions = {}): void {
  const store = useContext(StoreContext);
  const overlayId = useContext(OverlayContext);
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  const { scope = overlayId ? "overlay" : "screen", enabled = true, allowInInputs = false, allowRepeat } = options;
  const combos = JSON.stringify(typeof combo === "string" ? [combo] : combo);

  useEffect(() => {
    if (!store || !enabled) return;
    const unregister = (JSON.parse(combos) as string[]).map((text) => {
      const parsed = parseCombo(text);
      return store.register({
        combo: parsed,
        scope,
        overlayId,
        allowInInputs,
        allowRepeat: allowRepeat ?? parsed.key.startsWith("arrow"),
        handler: (event) => handlerRef.current(event),
      });
    });
    return () => unregister.forEach((fn) => fn());
  }, [store, combos, scope, overlayId, enabled, allowInInputs, allowRepeat]);
}

/**
 * Registers an overlay (Dialog, Sheet, Popover, Menu, ⌘K) while `open`, and
 * returns its id for <OverlayScope>. While any overlay is open, global and
 * screen shortcuts are off; only the top overlay's shortcuts run. Radix
 * overlays close themselves on Esc (top layer only); pass `onEscape` for
 * overlays that do not.
 */
export function useOverlay(open: boolean, options: { onEscape?: () => void } = {}): string {
  const store = useContext(StoreContext);
  const parentId = useContext(OverlayContext);
  const id = useId();
  const escapeRef = useRef(options.onEscape);
  useLayoutEffect(() => {
    escapeRef.current = options.onEscape;
  });
  const hasEscape = Boolean(options.onEscape);

  useEffect(() => {
    if (!store || !open) return;
    return store.openOverlay({ id, parentId, onEscape: hasEscape ? () => escapeRef.current?.() : undefined });
  }, [store, open, id, parentId, hasEscape]);
  return id;
}

/**
 * useOverlay for a root that may be controlled or not (Radix Popover,
 * Menu or Dialog wrappers): keeps its own open state when `open` is not
 * passed, and returns the open state and handler to give the Radix root
 * plus the id for <OverlayScope>.
 */
export function useOverlayRoot({
  open,
  defaultOpen = false,
  onOpenChange,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}): { open: boolean; onOpenChange: (open: boolean) => void; overlayId: string } {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const isOpen = open ?? innerOpen;
  const overlayId = useOverlay(isOpen);
  const changeOpen = (next: boolean) => {
    if (open === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };
  return { open: isOpen, onOpenChange: changeOpen, overlayId };
}

/** Marks its subtree as the content of overlay `id` (shortcuts and nested overlays inside it). */
export function OverlayScope({ id, children }: { id: string; children: ReactNode }) {
  return <OverlayContext.Provider value={id}>{children}</OverlayContext.Provider>;
}

const noSubscribe = () => () => {};

/** Whether any overlay is open (e.g. to pause a screen's own key handling). */
export function useOverlayOpen(): boolean {
  const store = useContext(StoreContext);
  return useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => (store ? store.overlayCount() > 0 : false),
    () => false,
  );
}

/** ⌘ on macOS (false while server rendering). */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => isMacPlatform(navigator),
    () => false,
  );
}

/** Display label of a combo for this platform: "⌘K" / "Ctrl+K". */
export function useShortcutLabel(combo: string): string {
  return formatCombo(combo, useIsMac());
}
