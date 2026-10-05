/**
 * Ajustes is a page of its own, outside the app layout. "← Voltar ao app"
 * and Esc return to the app URL the user left from (with its view, filters
 * and open sheet), remembered per tab in sessionStorage by the app layout.
 */

export const LAST_APP_URL_KEY = "capital:last-app-url";
export const APP_HOME = "/transactions";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

/** Paths that are app screens: not settings, not the login pages, not another origin. */
export function isAppUrl(url: string | null | undefined): url is string {
  if (!url || !url.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) return false;
  const path = url.split(/[?#]/)[0];
  return path !== "/" && !["/settings", "/login", "/signup"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function rememberAppUrl(storage: KeyValueStorage | null, url: string): void {
  if (!isAppUrl(url)) return;
  try {
    storage?.setItem(LAST_APP_URL_KEY, url);
  } catch {
    // Storage disabled: going back lands on /transactions.
  }
}

export function lastAppUrl(storage: KeyValueStorage | null): string {
  let url: string | null = null;
  try {
    url = storage?.getItem(LAST_APP_URL_KEY) ?? null;
  } catch {
    url = null;
  }
  return isAppUrl(url) ? url : APP_HOME;
}

/** sessionStorage, or null where it is unavailable (server, blocked storage). */
export function sessionStore(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
