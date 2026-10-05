import { describe, expect, it, vi } from "vitest";
import { decodeCreateParam } from "@/lib/ledger/quick-add";
import { createEntryTarget, SHELL_SHORTCUTS, type ShellShortcut } from "@/lib/shell/shortcuts";
import { parseCombo } from "@/lib/shortcuts/combo";
import { createShortcutStore, type KeyDownLike, type ShortcutStore } from "@/lib/shortcuts/store";

const BODY = { tagName: "BODY", getAttribute: () => null };
const INPUT = { tagName: "INPUT", type: "text", getAttribute: () => null };

function press(key: string, init: Partial<KeyDownLike> = {}): KeyDownLike & { prevented: boolean } {
  const event = {
    key,
    code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : undefined,
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
    ...init,
  };
  return event;
}

/** The shell's bindings as AppShell, the palette and UndoBridge register them. */
function shell() {
  const store = createShortcutStore();
  const handlers = Object.fromEntries(Object.keys(SHELL_SHORTCUTS).map((name) => [name, vi.fn()])) as Record<ShellShortcut, ReturnType<typeof vi.fn>>;
  for (const [name, binding] of Object.entries(SHELL_SHORTCUTS) as [ShellShortcut, (typeof SHELL_SHORTCUTS)[ShellShortcut]][]) {
    const combo = parseCombo(binding.combo);
    store.register({ combo, scope: "global", overlayId: null, allowInInputs: binding.allowInInputs, allowRepeat: false, handler: handlers[name] });
  }
  return { store, handlers };
}

function fired(handlers: Record<ShellShortcut, ReturnType<typeof vi.fn>>): ShellShortcut[] {
  return (Object.keys(handlers) as ShellShortcut[]).filter((name) => handlers[name].mock.calls.length > 0);
}

function openPalette(store: ShortcutStore, close: () => void) {
  const off = store.openOverlay({ id: "cmdk", parentId: null });
  store.register({ combo: parseCombo(SHELL_SHORTCUTS.command.combo), scope: "overlay", overlayId: "cmdk", allowInInputs: true, allowRepeat: false, handler: close });
  return off;
}

describe("shell shortcut bindings", () => {
  it("are valid, distinct combos", () => {
    const combos = Object.values(SHELL_SHORTCUTS).map((binding) => JSON.stringify(parseCombo(binding.combo)));
    expect(new Set(combos).size).toBe(combos.length);
  });

  it.each([
    ["n", {}, "create"],
    ["k", { metaKey: true }, "command"],
    [",", { metaKey: true }, "settings"],
    ["b", { metaKey: true }, "sidebar"],
    ["z", { metaKey: true }, "undo"],
  ] as const)("on a Mac, %s (%o) runs %s", (key, mods, action) => {
    const { store, handlers } = shell();
    const event = press(key, mods);
    expect(store.handleKeyDown(event, true)).toBe(true);
    expect(fired(handlers)).toEqual([action]);
    expect(event.prevented).toBe(true);
  });

  it("uses Ctrl elsewhere, and ⌘ is not Ctrl", () => {
    const { store, handlers } = shell();
    store.handleKeyDown(press("k", { ctrlKey: true }), false);
    store.handleKeyDown(press(",", { ctrlKey: true }), false);
    expect(fired(handlers)).toEqual(["command", "settings"]);
    const mac = shell();
    expect(mac.store.handleKeyDown(press("k", { ctrlKey: true }), true)).toBe(false);
    expect(fired(mac.handlers)).toEqual([]);
  });

  it("keeps N, ⌘B and ⌘Z for the text field while typing; ⌘K and ⌘, still work there", () => {
    const { store, handlers } = shell();
    for (const [key, mods] of [["n", {}], ["b", { metaKey: true }], ["z", { metaKey: true }]] as const) {
      const event = press(key, { ...mods, target: INPUT });
      expect(store.handleKeyDown(event, true)).toBe(false);
      expect(event.prevented).toBe(false);
    }
    expect(fired(handlers)).toEqual([]);
    store.handleKeyDown(press("k", { metaKey: true, target: INPUT }), true);
    store.handleKeyDown(press(",", { metaKey: true, target: INPUT }), true);
    expect(fired(handlers)).toEqual(["command", "settings"]);
  });

  it("does not fire N for ⇧N, ⌘N (new window), a held key or an IME composition", () => {
    const { store, handlers } = shell();
    store.handleKeyDown(press("N", { shiftKey: true }), true);
    store.handleKeyDown(press("n", { metaKey: true }), true);
    store.handleKeyDown(press("n", { repeat: true }), true);
    store.handleKeyDown(press("n", { isComposing: true }), true);
    expect(fired(handlers)).toEqual([]);
  });

  it("pauses while an overlay is open; inside ⌘K, ⌘K closes it", () => {
    const { store, handlers } = shell();
    const close = vi.fn();
    const closePalette = openPalette(store, close);
    store.handleKeyDown(press("n"), true);
    store.handleKeyDown(press(",", { metaKey: true }), true);
    store.handleKeyDown(press("z", { metaKey: true }), true);
    expect(fired(handlers)).toEqual([]);
    store.handleKeyDown(press("k", { metaKey: true, target: INPUT }), true);
    expect(close).toHaveBeenCalledOnce();
    expect(handlers.command).not.toHaveBeenCalled();
    closePalette();
    store.handleKeyDown(press("n"), true);
    expect(fired(handlers)).toEqual(["create"]);
  });
});

describe("N: Nova transação", () => {
  it("opens the dialog over the current view on Transações", () => {
    expect(createEntryTarget("/transactions")).toEqual({ kind: "param" });
  });

  it("goes to Transações with a blank create dialog from other screens", () => {
    for (const path of ["/transactions/budgets", "/investments", "/investments/contributions"]) {
      const target = createEntryTarget(path);
      expect(target.kind).toBe("navigate");
      if (target.kind !== "navigate") continue;
      const url = new URL(target.href, "http://local.invalid");
      expect(url.pathname).toBe("/transactions");
      expect(decodeCreateParam(url.searchParams.get("create"))).toEqual({});
      expect([...url.searchParams.keys()]).toEqual(["create"]);
    }
  });
});
