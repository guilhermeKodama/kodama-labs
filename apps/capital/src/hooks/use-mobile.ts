import { useSyncExternalStore } from "react"

export const MOBILE_BREAKPOINT = 768

function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

// Server snapshot is always `false` — every consumer of this hook today
// (FormDialog's drawer/dialog branch, the nav breakpoint switch) only acts
// after interaction or is already gated behind AppShell's post-mount render,
// so there's nothing that depends on guessing the client's viewport during
// SSR. useSyncExternalStore keeps this safe to call unconditionally (no
// hydration mismatch) without the double-render flash a useEffect-based
// version would cause.
function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
