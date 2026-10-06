import { describe, expect, it } from "vitest";
import { isEditableTarget } from "@/lib/shortcuts/editable";
import { resolveShortcuts, topOverlay, type ShortcutRegistration } from "@/lib/shortcuts/resolve";

const element = (tagName: string, extra: Record<string, unknown> = {}, role: string | null = null) => ({
  tagName,
  getAttribute: (name: string) => (name === "role" ? role : null),
  ...extra,
});

describe("isEditableTarget", () => {
  it("is true where keys type text", () => {
    expect(isEditableTarget(element("INPUT"))).toBe(true);
    expect(isEditableTarget(element("input", { type: "search" }))).toBe(true);
    expect(isEditableTarget(element("INPUT", { type: "number" }))).toBe(true);
    expect(isEditableTarget(element("TEXTAREA"))).toBe(true);
    expect(isEditableTarget(element("SELECT"))).toBe(true);
    expect(isEditableTarget(element("DIV", { isContentEditable: true }))).toBe(true);
    expect(isEditableTarget(element("DIV", {}, "textbox"))).toBe(true);
    // Radix Select trigger: a button with typeahead.
    expect(isEditableTarget(element("BUTTON", {}, "combobox"))).toBe(true);
  });

  it("is false for buttons, checkboxes, read-only fields and the page", () => {
    expect(isEditableTarget(element("BUTTON"))).toBe(false);
    expect(isEditableTarget(element("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isEditableTarget(element("INPUT", { type: "radio" }))).toBe(false);
    expect(isEditableTarget(element("INPUT", { readOnly: true }))).toBe(false);
    expect(isEditableTarget(element("TEXTAREA", { readOnly: true }))).toBe(false);
    expect(isEditableTarget(element("BODY"))).toBe(false);
    expect(isEditableTarget(element("TR", {}, "row"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(windowLike())).toBe(false);
  });
});

// The window object as an event target: no tagName at all.
function windowLike() {
  return { addEventListener() {} };
}

describe("topOverlay", () => {
  it("is null with nothing open, and the last opened among independent overlays", () => {
    expect(topOverlay([])).toBeNull();
    expect(
      topOverlay([
        { id: "a", parentId: null, seq: 1 },
        { id: "b", parentId: null, seq: 2 },
      ]),
    ).toBe("b");
  });

  it("puts a nested overlay above its parent even when it registered first", () => {
    // React runs a child's effect before its parent's in the same commit.
    expect(
      topOverlay([
        { id: "popover", parentId: "dialog", seq: 1 },
        { id: "dialog", parentId: null, seq: 2 },
      ]),
    ).toBe("popover");
  });

  it("follows the most recent branch", () => {
    const entries = [
      { id: "dialog", parentId: null, seq: 1 },
      { id: "combobox", parentId: "dialog", seq: 2 },
      { id: "sheet", parentId: null, seq: 3 },
    ];
    expect(topOverlay(entries)).toBe("sheet");
    expect(topOverlay([...entries, { id: "menu", parentId: "dialog", seq: 4 }])).toBe("menu");
    expect(topOverlay([...entries, { id: "nested", parentId: "combobox", seq: 4 }])).toBe("nested");
  });

  it("treats an overlay whose parent is closed as a root", () => {
    expect(
      topOverlay([
        { id: "a", parentId: "gone", seq: 2 },
        { id: "b", parentId: null, seq: 1 },
      ]),
    ).toBe("a");
  });
});

type Reg = ShortcutRegistration & { name: string };
const reg = (name: string, id: number, scope: Reg["scope"], extra: Partial<Reg> = {}): Reg => ({
  name,
  id,
  scope,
  overlayId: null,
  allowInInputs: false,
  allowRepeat: false,
  ...extra,
});
const names = (list: Reg[]) => list.map((item) => item.name);
const all = () => true;
const idle = { topOverlay: null, editable: false, repeat: false };

describe("resolveShortcuts", () => {
  it("prefers screen over global, and the newest within a scope", () => {
    const regs = [reg("global", 1, "global"), reg("screen-old", 2, "screen"), reg("screen-new", 3, "screen")];
    expect(names(resolveShortcuts(regs, idle, all))).toEqual(["screen-new", "screen-old", "global"]);
  });

  it("runs only the top overlay's shortcuts while an overlay is open", () => {
    const regs = [
      reg("global", 1, "global"),
      reg("screen", 2, "screen"),
      reg("dialog", 3, "overlay", { overlayId: "dialog" }),
      reg("popover", 4, "overlay", { overlayId: "popover" }),
    ];
    expect(names(resolveShortcuts(regs, { ...idle, topOverlay: "dialog" }, all))).toEqual(["dialog"]);
    expect(names(resolveShortcuts(regs, { ...idle, topOverlay: "popover" }, all))).toEqual(["popover"]);
    expect(names(resolveShortcuts(regs, { ...idle, topOverlay: "other" }, all))).toEqual([]);
    expect(names(resolveShortcuts(regs, idle, all))).toEqual(["screen", "global"]);
  });

  it("skips shortcuts that do not allow typing targets or key repeat", () => {
    const regs = [reg("n", 1, "global"), reg("save", 2, "screen", { allowInInputs: true }), reg("down", 3, "screen", { allowRepeat: true })];
    expect(names(resolveShortcuts(regs, { ...idle, editable: true }, all))).toEqual(["save"]);
    expect(names(resolveShortcuts(regs, { ...idle, repeat: true }, all))).toEqual(["down"]);
  });

  it("only keeps matching combos", () => {
    const regs = [reg("a", 1, "global"), reg("b", 2, "screen")];
    expect(names(resolveShortcuts(regs, idle, (item) => item.name === "a"))).toEqual(["a"]);
  });
});
