/**
 * Check if a pathname should be excluded from the session middleware.
 * This includes API routes, the MCP endpoint, and Next.js internals.
 */
export function isExcludedPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api") ||
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  );
}

/**
 * Splits a leading locale segment off a pathname: "/en/transactions" →
 * { locale: "en", path: "/transactions" }. URLs normally have none
 * (localePrefix "never"); `locale` is null then and `path` is unchanged.
 */
export function stripLocalePrefix(pathname: string, locales: readonly string[]): { locale: string | null; path: string } {
  const locale = locales.find((candidate) => pathname === `/${candidate}` || pathname.startsWith(`/${candidate}/`)) ?? null;
  return { locale, path: locale ? pathname.slice(locale.length + 1) || "/" : pathname };
}

const LOCAL_ORIGIN = "http://local.invalid";

/**
 * Whether `url` is a path on this origin. The browser drops tabs and
 * newlines from a URL and reads "\" as "/", so "/\t/evil.example" and
 * "/\\evil.example" lead to another site although they start with one
 * "/": those characters are refused, and the URL must also resolve to
 * this origin.
 */
export function isLocalPath(url: string | null | undefined): url is string {
  if (!url || !url.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(url)) return false;
  try {
    return new URL(url, LOCAL_ORIGIN).origin === LOCAL_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Where the app goes back to after logging in: `redirect` when it is a
 * path of this app (never another origin, never the login pages
 * themselves), else /transactions.
 */
export function safeRedirect(redirect: string | null | undefined): string {
  if (!isLocalPath(redirect)) return "/transactions";
  const path = redirect.split(/[?#]/)[0];
  if (path === "/" || path === "/login" || path === "/signup") return "/transactions";
  return redirect;
}

/** The login page, returning to `from` (path plus query) afterwards when that is a safe redirect. */
export function loginPath(from: string | null | undefined): string {
  return from && safeRedirect(from) === from ? `/login?redirect=${encodeURIComponent(from)}` : "/login";
}

/**
 * Matcher config for Next.js middleware.
 * This is a best-effort exclusion pattern. The actual exclusion logic
 * in isExcludedPath() is authoritative.
 */
export const middlewareConfig = {
  matcher: [
    // Match all paths...
    "/(.*)",
    // Except root
    "/",
  ],
};
