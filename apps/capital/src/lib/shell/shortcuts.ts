import { buildTransactionsHref } from "@/lib/ledger/view-draft";

/**
 * The app-wide keys, owned by the shell and nowhere else (a screen must
 * not bind these). All are registered with scope "global": they run only
 * with no overlay open, and only the ones marked `allowInInputs` run with
 * focus in a text field (modifier combos that type nothing there).
 *
 * - N: "Nova transação" (the create dialog of Transações, from any screen,
 *   Ajustes included; N and ⌘, are bound by components/shell/global-keys.tsx).
 * - ⌘K: the command palette (it also closes it, from inside).
 * - ⌘,: Ajustes, coming back later to the screen it was opened from.
 * - ⌘B: the sidebar rail (the drawer below md).
 * - ⌘Z: undo the latest change; bound by UndoBridge (lib/api/undo-bridge.tsx),
 *   which also serves Ajustes, using this same entry.
 */
export const SHELL_SHORTCUTS = {
  create: { combo: "n", allowInInputs: false },
  command: { combo: "mod+k", allowInInputs: true },
  settings: { combo: "mod+,", allowInInputs: true },
  sidebar: { combo: "mod+b", allowInInputs: false },
  undo: { combo: "mod+z", allowInInputs: false },
} as const satisfies Record<string, { combo: string; allowInInputs: boolean }>;

export type ShellShortcut = keyof typeof SHELL_SHORTCUTS;

export const SETTINGS_PATH = "/settings";
export const TRANSACTIONS_PATH = "/transactions";

/**
 * What N does from `pathname`: on Transações the create dialog opens over
 * the current view (the `create` param is added, nothing else changes);
 * from any other screen the app goes to Transações with the dialog open.
 */
export function createEntryTarget(pathname: string): { kind: "param" } | { kind: "navigate"; href: string } {
  if (pathname === TRANSACTIONS_PATH) return { kind: "param" };
  return { kind: "navigate", href: buildTransactionsHref({ create: {} }) };
}

/** Whether `pathname` is Ajustes (the page itself or one of its sections). */
export function isSettingsPath(pathname: string): boolean {
  return pathname === SETTINGS_PATH || pathname.startsWith(`${SETTINGS_PATH}/`);
}

/**
 * What ⌘, does from `pathname`: from an app screen it opens Ajustes (the
 * screen is remembered for "← Voltar ao app"); inside Ajustes it does
 * nothing, so the remembered screen is not replaced by Ajustes itself.
 */
export function settingsShortcutTarget(pathname: string): "open" | "stay" {
  return isSettingsPath(pathname) ? "stay" : "open";
}
