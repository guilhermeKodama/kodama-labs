import { matchesCombo, type Combo, type KeyEventLike } from "./combo";
import { isEditableTarget } from "./editable";
import { resolveShortcuts, topOverlay, type OverlayEntry, type ShortcutRegistration } from "./resolve";

/** Return false to let the next matching shortcut (or the browser) have the key. */
export type ShortcutHandler = (event: KeyboardEvent) => void | boolean;

export interface ShortcutInput extends Omit<ShortcutRegistration, "id"> {
  combo: Combo;
  handler: ShortcutHandler;
}

/** The parts of a keydown event the store reads and acts on. */
export interface KeyDownLike extends KeyEventLike {
  target: unknown;
  repeat: boolean;
  defaultPrevented: boolean;
  isComposing?: boolean;
  preventDefault(): void;
}

/**
 * Registered shortcuts and open overlays, plus the keydown dispatch. No
 * React or DOM here: <ShortcutProvider> owns one instance and feeds it
 * window keydown events.
 */
export interface ShortcutStore {
  register(input: ShortcutInput): () => void;
  /** Marks an overlay open until the returned function runs. `onEscape` is for overlays Radix does not close. */
  openOverlay(entry: { id: string; parentId: string | null; onEscape?: () => void }): () => void;
  topOverlay(): string | null;
  overlayCount(): number;
  subscribe(listener: () => void): () => void;
  /** Runs the shortcut for this key press, if any; true when one handled it. */
  handleKeyDown(event: KeyDownLike, isMac: boolean): boolean;
  /**
   * Window capture phase, before any other listener: notes an Esc pressed
   * while an overlay is open. Radix may close that overlay in its own
   * listener before handleOverlayEscape runs.
   */
  claimEscape(event: KeyDownLike): void;
  /**
   * Capture phase on <html>, after Radix's document listeners: an Esc that
   * claimEscape noted belongs to the overlay stack. Runs it (the top
   * overlay's onEscape, unless Radix already closed its layer) and returns
   * true, so the caller stops it there and no page-level keydown listener
   * sees an Esc that closed an overlay.
   */
  handleOverlayEscape(event: KeyDownLike, isMac: boolean): boolean;
}

export function createShortcutStore(): ShortcutStore {
  let seq = 0;
  const shortcuts = new Map<number, ShortcutInput & { id: number }>();
  const overlays = new Map<string, OverlayEntry & { onEscape?: () => void }>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const top = () => topOverlay([...overlays.values()]);
  let claimedEscape: KeyDownLike | null = null;

  const store: ShortcutStore = {
    register(input) {
      const id = ++seq;
      shortcuts.set(id, { ...input, id });
      return () => {
        shortcuts.delete(id);
      };
    },
    openOverlay({ id, parentId, onEscape }) {
      const entry = { id, parentId, seq: ++seq, onEscape };
      overlays.set(id, entry);
      emit();
      return () => {
        if (overlays.get(id) !== entry) return;
        overlays.delete(id);
        emit();
      };
    },
    topOverlay: top,
    overlayCount: () => overlays.size,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    handleKeyDown(event, isMac) {
      // Already handled (Radix closes its top layer on Esc and prevents the
      // default), or an IME composing a character.
      if (event.defaultPrevented || event.isComposing) return false;
      const topId = top();
      if (topId && event.key === "Escape") {
        const onEscape = overlays.get(topId)?.onEscape;
        if (onEscape) {
          event.preventDefault();
          onEscape();
          return true;
        }
      }
      const candidates = resolveShortcuts(
        [...shortcuts.values()],
        { topOverlay: topId, editable: isEditableTarget(event.target), repeat: event.repeat },
        (shortcut) => matchesCombo(shortcut.combo, event, isMac),
      );
      for (const shortcut of candidates) {
        if (shortcut.handler(event as unknown as KeyboardEvent) === false) continue;
        event.preventDefault();
        return true;
      }
      return false;
    },
    claimEscape(event) {
      claimedEscape = event.key === "Escape" && !event.isComposing && overlays.size > 0 ? event : null;
    },
    handleOverlayEscape(event, isMac) {
      if (event !== claimedEscape) return false;
      claimedEscape = null;
      store.handleKeyDown(event, isMac);
      return true;
    },
  };
  return store;
}
