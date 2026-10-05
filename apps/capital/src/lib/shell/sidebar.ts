/**
 * The sidebar's two states. On wide screens it is either the 200px list
 * or a narrow rail of icons (▤ in the header or ⌘B), and that choice is
 * kept in localStorage. Below md it is hidden and opens as a drawer,
 * which always starts closed.
 */

export type SidebarMode = "expanded" | "rail";

export const SIDEBAR_STORAGE_KEY = "capital:sidebar";

/** Breakpoint (Tailwind md) above which the sidebar is part of the page. */
export const SIDEBAR_DRAWER_QUERY = "(max-width: 767.98px)";

export function parseSidebarMode(raw: string | null | undefined): SidebarMode {
  return raw === "rail" ? "rail" : "expanded";
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export interface SidebarState {
  mode: SidebarMode;
  drawerOpen: boolean;
}

export interface SidebarStore {
  get: () => SidebarState;
  subscribe: (listener: () => void) => () => void;
  setMode: (mode: SidebarMode) => void;
  setDrawerOpen: (open: boolean) => void;
  /** ▤ and ⌘B: rail ↔ expanded on wide screens, open/close the drawer on narrow ones. */
  toggle: (narrow: boolean) => void;
}

/** `storage` is null where localStorage is unavailable (server, private mode): the mode then lives in memory. */
export function createSidebarStore(storage: KeyValueStorage | null): SidebarStore {
  let state: SidebarState = { mode: parseSidebarMode(read(storage)), drawerOpen: false };
  const listeners = new Set<() => void>();
  const set = (next: SidebarState) => {
    if (next.mode === state.mode && next.drawerOpen === state.drawerOpen) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  const setMode = (mode: SidebarMode) => {
    try {
      storage?.setItem(SIDEBAR_STORAGE_KEY, mode);
    } catch {
      // Quota or a disabled store: the choice lasts until reload.
    }
    set({ ...state, mode });
  };
  const setDrawerOpen = (drawerOpen: boolean) => set({ ...state, drawerOpen });
  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setMode,
    setDrawerOpen,
    toggle: (narrow) => (narrow ? setDrawerOpen(!state.drawerOpen) : setMode(state.mode === "rail" ? "expanded" : "rail")),
  };
}

function read(storage: KeyValueStorage | null): string | null {
  try {
    return storage?.getItem(SIDEBAR_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}
