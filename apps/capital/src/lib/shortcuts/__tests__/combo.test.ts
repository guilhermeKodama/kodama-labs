import { describe, expect, it } from "vitest";
import { formatCombo, isMacPlatform, matchesCombo, normalizeKey, parseCombo, type KeyEventLike } from "@/lib/shortcuts/combo";

const key = (k: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("parseCombo", () => {
  it("parses modifiers and keys", () => {
    expect(parseCombo("mod+k")).toEqual({ key: "k", mod: true, ctrl: false, meta: false, alt: false, shift: false });
    expect(parseCombo("Mod+Shift+D")).toMatchObject({ key: "d", mod: true, shift: true });
    expect(parseCombo("mod+,")).toMatchObject({ key: ",", mod: true });
    expect(parseCombo("mod+enter")).toMatchObject({ key: "enter", mod: true });
    expect(parseCombo("n")).toEqual({ key: "n", mod: false, ctrl: false, meta: false, alt: false, shift: false });
    expect(parseCombo("ctrl+alt+x")).toMatchObject({ key: "x", ctrl: true, alt: true });
    expect(parseCombo("cmd+b")).toMatchObject({ key: "b", meta: true, mod: false });
  });

  it("understands key aliases", () => {
    expect(parseCombo("esc").key).toBe("escape");
    expect(parseCombo("up").key).toBe("arrowup");
    expect(parseCombo("arrowdown").key).toBe("arrowdown");
    expect(parseCombo("space").key).toBe(" ");
    expect(parseCombo("mod++").key).toBe("+");
  });

  it("fails loudly on typos", () => {
    expect(() => parseCombo("mdo+k")).toThrow(/unknown modifier/);
    expect(() => parseCombo("mod+")).toThrow(/no key/);
  });
});

describe("normalizeKey", () => {
  it("lowercases and maps legacy names", () => {
    expect(normalizeKey("K")).toBe("k");
    expect(normalizeKey("Escape")).toBe("escape");
    expect(normalizeKey("Esc")).toBe("escape");
    expect(normalizeKey("ArrowUp")).toBe("arrowup");
    expect(normalizeKey(" ")).toBe(" ");
  });
});

describe("matchesCombo", () => {
  const modK = parseCombo("mod+k");

  it("reads mod as ⌘ on a Mac and Ctrl elsewhere", () => {
    expect(matchesCombo(modK, key("k", { metaKey: true }), true)).toBe(true);
    expect(matchesCombo(modK, key("k", { ctrlKey: true }), true)).toBe(false);
    expect(matchesCombo(modK, key("k", { ctrlKey: true }), false)).toBe(true);
    expect(matchesCombo(modK, key("k", { metaKey: true }), false)).toBe(false);
  });

  it("requires the exact modifiers", () => {
    expect(matchesCombo(modK, key("k"), true)).toBe(false);
    expect(matchesCombo(modK, key("K", { metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(matchesCombo(modK, key("k", { metaKey: true, altKey: true }), true)).toBe(false);
    expect(matchesCombo(parseCombo("n"), key("n", { metaKey: true }), true)).toBe(false);
    expect(matchesCombo(parseCombo("n"), key("N", { shiftKey: true }), true)).toBe(false);
    expect(matchesCombo(parseCombo("mod+shift+d"), key("D", { metaKey: true, shiftKey: true }), true)).toBe(true);
  });

  it("matches single keys and named keys", () => {
    expect(matchesCombo(parseCombo("n"), key("n"), false)).toBe(true);
    expect(matchesCombo(parseCombo("x"), key("X"), false)).toBe(true); // caps lock
    expect(matchesCombo(parseCombo("backspace"), key("Backspace"), true)).toBe(true);
    expect(matchesCombo(parseCombo("escape"), key("Escape"), true)).toBe(true);
    expect(matchesCombo(parseCombo("arrowdown"), key("ArrowDown"), true)).toBe(true);
    expect(matchesCombo(parseCombo("enter"), key("Enter"), true)).toBe(true);
    expect(matchesCombo(parseCombo("mod+enter"), key("Enter", { metaKey: true }), true)).toBe(true);
    expect(matchesCombo(parseCombo("mod+a"), key("a", { ctrlKey: true }), false)).toBe(true);
    expect(matchesCombo(parseCombo("mod+,"), key(",", { metaKey: true }), true)).toBe(true);
  });

  it("ignores Shift for symbols that need it on the layout", () => {
    expect(matchesCombo(parseCombo("?"), key("?", { shiftKey: true }), true)).toBe(true);
    expect(matchesCombo(parseCombo("shift+?"), key("?"), true)).toBe(false);
  });

  it("falls back to the physical key when the layout changes the character", () => {
    expect(matchesCombo(parseCombo("mod+k"), key("л", { code: "KeyK", ctrlKey: true }), false)).toBe(true);
    expect(matchesCombo(parseCombo("alt+n"), key("˜", { code: "KeyN", altKey: true }), true)).toBe(true);
    expect(matchesCombo(parseCombo("mod+1"), key("&", { code: "Digit1", ctrlKey: true }), false)).toBe(true);
    expect(matchesCombo(parseCombo("mod+k"), key("j", { code: "KeyJ", metaKey: true }), true)).toBe(false);
  });
});

describe("formatCombo", () => {
  it("uses symbols on a Mac", () => {
    expect(formatCombo("mod+k", true)).toBe("⌘K");
    expect(formatCombo("mod+enter", true)).toBe("⌘↵");
    expect(formatCombo("mod+,", true)).toBe("⌘,");
    expect(formatCombo("mod+shift+d", true)).toBe("⇧⌘D");
    expect(formatCombo("backspace", true)).toBe("⌫");
    expect(formatCombo("escape", true)).toBe("Esc");
    expect(formatCombo("arrowup", true)).toBe("↑");
    expect(formatCombo("n", true)).toBe("N");
  });

  it("spells out modifiers elsewhere", () => {
    expect(formatCombo("mod+k", false)).toBe("Ctrl+K");
    expect(formatCombo("mod+enter", false)).toBe("Ctrl+Enter");
    expect(formatCombo("mod+shift+d", false)).toBe("Ctrl+Shift+D");
    expect(formatCombo("backspace", false)).toBe("Backspace");
  });
});

describe("isMacPlatform", () => {
  it("detects macOS and iOS", () => {
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(isMacPlatform({ userAgentData: { platform: "macOS" } })).toBe(true);
    expect(isMacPlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe(true);
    expect(isMacPlatform({ platform: "Win32" })).toBe(false);
    expect(isMacPlatform({ userAgentData: { platform: "Linux" }, platform: "MacIntel" })).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
});
