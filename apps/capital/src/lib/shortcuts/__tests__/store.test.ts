import { describe, expect, it, vi } from "vitest";
import { parseCombo } from "@/lib/shortcuts/combo";
import { createShortcutStore, type KeyDownLike, type ShortcutInput } from "@/lib/shortcuts/store";

const BODY = { tagName: "BODY", getAttribute: () => null };
const INPUT = { tagName: "INPUT", type: "text", getAttribute: () => null };

function press(key: string, extra: Partial<KeyDownLike> = {}): KeyDownLike & { prevented: boolean } {
  const event = {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: BODY,
    repeat: false,
    defaultPrevented: false,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
    ...extra,
  };
  return event;
}

function shortcut(combo: string, handler: ShortcutInput["handler"], extra: Partial<ShortcutInput> = {}): ShortcutInput {
  return { combo: parseCombo(combo), handler, scope: "screen", overlayId: null, allowInInputs: false, allowRepeat: false, ...extra };
}

describe("createShortcutStore", () => {
  it("runs the matching shortcut and prevents the browser default", () => {
    const store = createShortcutStore();
    const newEntry = vi.fn();
    store.register(shortcut("n", newEntry, { scope: "global" }));
    const event = press("n");
    expect(store.handleKeyDown(event, true)).toBe(true);
    expect(newEntry).toHaveBeenCalledOnce();
    expect(event.prevented).toBe(true);
    expect(store.handleKeyDown(press("m"), true)).toBe(false);
  });

  it("stops after unregistering", () => {
    const store = createShortcutStore();
    const handler = vi.fn();
    const unregister = store.register(shortcut("x", handler));
    unregister();
    expect(store.handleKeyDown(press("x"), true)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores keys typed in a field unless allowed", () => {
    const store = createShortcutStore();
    const newEntry = vi.fn();
    const save = vi.fn();
    store.register(shortcut("n", newEntry, { scope: "global" }));
    store.register(shortcut("mod+enter", save, { allowInInputs: true }));
    expect(store.handleKeyDown(press("n", { target: INPUT }), true)).toBe(false);
    expect(store.handleKeyDown(press("Enter", { target: INPUT, metaKey: true }), true)).toBe(true);
    expect(newEntry).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
  });

  it("pauses global and screen shortcuts while an overlay is open", () => {
    const store = createShortcutStore();
    const undo = vi.fn();
    const submit = vi.fn();
    store.register(shortcut("mod+z", undo, { scope: "global" }));
    store.register(shortcut("mod+enter", submit, { scope: "overlay", overlayId: "dialog", allowInInputs: true }));

    const close = store.openOverlay({ id: "dialog", parentId: null });
    expect(store.overlayCount()).toBe(1);
    expect(store.handleKeyDown(press("z", { metaKey: true }), true)).toBe(false);
    expect(store.handleKeyDown(press("Enter", { metaKey: true }), true)).toBe(true);

    close();
    expect(store.overlayCount()).toBe(0);
    expect(store.handleKeyDown(press("z", { metaKey: true }), true)).toBe(true);
    expect(store.handleKeyDown(press("Enter", { metaKey: true }), true)).toBe(false);
    expect(undo).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("gives the key to the top overlay only", () => {
    const store = createShortcutStore();
    const dialogSave = vi.fn();
    const formSave = vi.fn();
    store.register(shortcut("mod+enter", dialogSave, { scope: "overlay", overlayId: "entry" }));
    store.register(shortcut("mod+enter", formSave, { scope: "overlay", overlayId: "new-account" }));
    store.openOverlay({ id: "entry", parentId: null });
    const closeNested = store.openOverlay({ id: "new-account", parentId: "entry" });
    store.handleKeyDown(press("Enter", { metaKey: true }), true);
    expect(formSave).toHaveBeenCalledOnce();
    expect(dialogSave).not.toHaveBeenCalled();
    closeNested();
    store.handleKeyDown(press("Enter", { metaKey: true }), true);
    expect(dialogSave).toHaveBeenCalledOnce();
  });

  it("leaves keys Radix already handled alone", () => {
    const store = createShortcutStore();
    const clearSelection = vi.fn();
    store.register(shortcut("escape", clearSelection));
    // Radix closes its top layer on Esc in the capture phase and prevents the default.
    expect(store.handleKeyDown(press("Escape", { defaultPrevented: true }), true)).toBe(false);
    expect(clearSelection).not.toHaveBeenCalled();
    expect(store.handleKeyDown(press("Escape"), true)).toBe(true);
    expect(clearSelection).toHaveBeenCalledOnce();
  });

  it("closes the top overlay that handles its own Esc", () => {
    const store = createShortcutStore();
    const closePalette = vi.fn();
    const closeDialog = vi.fn();
    store.openOverlay({ id: "dialog", parentId: null, onEscape: closeDialog });
    store.openOverlay({ id: "palette", parentId: null, onEscape: closePalette });
    expect(store.handleKeyDown(press("Escape"), true)).toBe(true);
    expect(closePalette).toHaveBeenCalledOnce();
    expect(closeDialog).not.toHaveBeenCalled();
  });

  it("passes the key on when a handler returns false", () => {
    const store = createShortcutStore();
    const global = vi.fn();
    store.register(shortcut("mod+a", global, { scope: "global" }));
    store.register(shortcut("mod+a", () => false));
    const event = press("a", { metaKey: true });
    expect(store.handleKeyDown(event, true)).toBe(true);
    expect(global).toHaveBeenCalledOnce();

    const store2 = createShortcutStore();
    store2.register(shortcut("mod+a", () => false));
    const declined = press("a", { metaKey: true });
    expect(store2.handleKeyDown(declined, true)).toBe(false);
    expect(declined.prevented).toBe(false);
  });

  it("ignores held keys except where repeat is allowed, and IME composition", () => {
    const store = createShortcutStore();
    const next = vi.fn();
    const create = vi.fn();
    store.register(shortcut("arrowdown", next, { allowRepeat: true }));
    store.register(shortcut("n", create, { scope: "global" }));
    store.handleKeyDown(press("ArrowDown", { repeat: true }), true);
    store.handleKeyDown(press("n", { repeat: true }), true);
    store.handleKeyDown(press("n", { isComposing: true }), true);
    expect(next).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("notifies subscribers when overlays open and close", () => {
    const store = createShortcutStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const close = store.openOverlay({ id: "a", parentId: null });
    close();
    close(); // closing twice is harmless
    unsubscribe();
    store.openOverlay({ id: "b", parentId: null });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.topOverlay()).toBe("b");
  });
});
