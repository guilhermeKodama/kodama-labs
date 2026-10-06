"use client";

import { useShortcut, type ShortcutOptions } from "@/lib/shortcuts/provider";
import type { ShortcutHandler } from "@/lib/shortcuts/store";
import { SHELL_SHORTCUTS, type ShellShortcut } from "./shortcuts";

/**
 * Binds one of the shell's keys from SHELL_SHORTCUTS, the single table
 * they come from: global scope, and text fields only where the table
 * allows. Every shell key is bound once, through this hook (N and ⌘, in
 * GlobalKeys, ⌘K in the palette, ⌘B in AppShell, ⌘Z in UndoBridge); a
 * screen never binds them itself, so a key cannot fire twice or drift
 * from the table.
 */
export function useShellShortcut(name: ShellShortcut, handler: ShortcutHandler, options: Pick<ShortcutOptions, "enabled"> = {}): void {
  const binding = SHELL_SHORTCUTS[name];
  useShortcut(binding.combo, handler, { ...options, scope: "global", allowInInputs: binding.allowInInputs });
}
