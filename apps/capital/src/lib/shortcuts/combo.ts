/**
 * Keyboard combos as written in code ("mod+k", "mod+enter", "n",
 * "backspace") and matching them against key events. `mod` is ⌘ on macOS
 * and Ctrl elsewhere. Pure: works on a minimal event shape so it can be
 * tested without a DOM.
 */

export interface Combo {
  /** Normalized key: "k", ",", "enter", "escape", "arrowup", " " … */
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

/** The fields of a KeyboardEvent the matcher reads. */
export interface KeyEventLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  del: "delete",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  space: " ",
  spacebar: " ",
  plus: "+",
};

/** Lowercase key name with the aliases above ("Esc" → "escape", "K" → "k"). */
export function normalizeKey(key: string): string {
  if (key === " ") return " ";
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

/** Parses "mod+shift+k". Throws on an unknown modifier or a missing key, so typos fail loudly. */
export function parseCombo(text: string): Combo {
  // "mod++" ends with the "+" key itself.
  const parts = text.endsWith("++") ? [...text.slice(0, -2).split("+"), "+"] : text.split("+");
  const combo: Combo = { key: "", mod: false, ctrl: false, meta: false, alt: false, shift: false };
  parts.forEach((part, index) => {
    const name = part.trim().toLowerCase();
    if (index === parts.length - 1) {
      if (!name && part !== " ") throw new Error(`Shortcut "${text}" has no key`);
      combo.key = normalizeKey(part === " " ? " " : name);
      return;
    }
    if (name === "mod") combo.mod = true;
    else if (name === "ctrl" || name === "control") combo.ctrl = true;
    else if (name === "meta" || name === "cmd" || name === "command") combo.meta = true;
    else if (name === "alt" || name === "option" || name === "opt") combo.alt = true;
    else if (name === "shift") combo.shift = true;
    else throw new Error(`Shortcut "${text}" has an unknown modifier "${part}"`);
  });
  return combo;
}

const isLetterOrDigit = (key: string) => /^[a-z0-9]$/.test(key);
// Named keys ("enter", "arrowup") and letters/digits compare Shift exactly;
// symbols like "?" or "," already depend on Shift through the layout.
const shiftIsExplicit = (key: string) => key.length > 1 || isLetterOrDigit(key);

/** Whether `event` is `combo`. Modifiers must match exactly (⌘K is not ⌘⇧K, nor Ctrl+K on a Mac). */
export function matchesCombo(combo: Combo, event: KeyEventLike, isMac: boolean): boolean {
  const wantMeta = combo.meta || (combo.mod && isMac);
  const wantCtrl = combo.ctrl || (combo.mod && !isMac);
  if (event.metaKey !== wantMeta || event.ctrlKey !== wantCtrl || event.altKey !== combo.alt) return false;
  if (shiftIsExplicit(combo.key) ? event.shiftKey !== combo.shift : combo.shift && !event.shiftKey) return false;
  if (normalizeKey(event.key) === combo.key) return true;
  // Option on a Mac and non-Latin layouts change event.key; the physical key still matches.
  if (isLetterOrDigit(combo.key) && event.code) {
    return event.code === (/\d/.test(combo.key) ? `Digit${combo.key}` : `Key${combo.key.toUpperCase()}`);
  }
  return false;
}

const MAC_KEYS: Record<string, string> = {
  enter: "↵",
  escape: "Esc",
  backspace: "⌫",
  delete: "⌦",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  tab: "⇥",
  " ": "Space",
};

const OTHER_KEYS: Record<string, string> = {
  enter: "Enter",
  escape: "Esc",
  backspace: "Backspace",
  delete: "Del",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  tab: "Tab",
  " ": "Space",
};

/** Display form for hints and <Kbd>: "⌘K", "⌘↵", "⇧⌘D" on a Mac; "Ctrl+K", "Ctrl+Enter" elsewhere. */
export function formatCombo(combo: string | Combo, isMac: boolean): string {
  const parsed = typeof combo === "string" ? parseCombo(combo) : combo;
  const key = (isMac ? MAC_KEYS : OTHER_KEYS)[parsed.key] ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
  const ctrl = parsed.ctrl || (parsed.mod && !isMac);
  const meta = parsed.meta || (parsed.mod && isMac);
  if (isMac) return `${ctrl ? "⌃" : ""}${parsed.alt ? "⌥" : ""}${parsed.shift ? "⇧" : ""}${meta ? "⌘" : ""}${key}`;
  return [ctrl && "Ctrl", meta && "Win", parsed.alt && "Alt", parsed.shift && "Shift", key].filter(Boolean).join("+");
}

/** macOS/iOS: ⌘ is the command modifier there. */
export function isMacPlatform(nav?: { platform?: string; userAgent?: string; userAgentData?: { platform?: string } } | null): boolean {
  if (!nav) return false;
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}
