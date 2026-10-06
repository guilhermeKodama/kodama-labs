/**
 * Which shortcut handles a key press. Three scopes, lowest to highest:
 * - global: the shell (N, ⌘K, ⌘,, ⌘Z, ⌘B);
 * - screen: the page under the shell (table keys X, ⌘A, ⌫ …);
 * - overlay: inside a dialog, sheet, popover or ⌘K (⌘↵ to save).
 * While any overlay is open only the top overlay's shortcuts run; with
 * focus in a text field only those registered with allowInInputs run.
 */

export type ShortcutScope = "global" | "screen" | "overlay";

export interface ShortcutRegistration {
  /** Registration order; later (deeper, newer) wins within a scope. */
  id: number;
  scope: ShortcutScope;
  /** The overlay the registering component lives in, null outside overlays. */
  overlayId: string | null;
  allowInInputs: boolean;
  allowRepeat: boolean;
}

export interface OverlayEntry {
  id: string;
  /** The overlay this one was opened from (a popover inside a dialog), if any. */
  parentId: string | null;
  /** Open order. */
  seq: number;
}

/**
 * The overlay on top. Nested overlays sit above their parent whatever the
 * registration order (React registers children before parents in the same
 * commit); among independent overlays the last opened wins.
 */
export function topOverlay(entries: readonly OverlayEntry[]): string | null {
  if (!entries.length) return null;
  const ids = new Set(entries.map((entry) => entry.id));
  const children = new Map<string | null, OverlayEntry[]>();
  for (const entry of entries) {
    const parent = entry.parentId && ids.has(entry.parentId) ? entry.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), entry]);
  }
  const latest = new Map<string, number>();
  const subtreeLatest = (entry: OverlayEntry): number => {
    const cached = latest.get(entry.id);
    if (cached !== undefined) return cached;
    const value = Math.max(entry.seq, ...(children.get(entry.id) ?? []).map(subtreeLatest));
    latest.set(entry.id, value);
    return value;
  };
  const newest = (list: OverlayEntry[]) => list.reduce((best, entry) => (subtreeLatest(entry) > subtreeLatest(best) ? entry : best));
  let current = newest(children.get(null) ?? entries.slice(0, 1));
  for (let next = children.get(current.id); next?.length; next = children.get(current.id)) current = newest(next);
  return current.id;
}

const SCOPE_RANK: Record<ShortcutScope, number> = { overlay: 2, screen: 1, global: 0 };

/**
 * Registrations allowed to handle the press, in the order to try them
 * (a handler can return false to pass it on). `matches` checks the combo.
 */
export function resolveShortcuts<T extends ShortcutRegistration>(
  registrations: readonly T[],
  context: { topOverlay: string | null; editable: boolean; repeat: boolean },
  matches: (registration: T) => boolean,
): T[] {
  return registrations
    .filter((registration) => {
      if (context.topOverlay ? registration.scope !== "overlay" || registration.overlayId !== context.topOverlay : registration.scope === "overlay") return false;
      if (context.editable && !registration.allowInInputs) return false;
      if (context.repeat && !registration.allowRepeat) return false;
      return matches(registration);
    })
    .sort((a, b) => SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope] || b.id - a.id);
}
