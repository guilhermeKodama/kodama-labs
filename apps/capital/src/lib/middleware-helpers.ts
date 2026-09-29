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
    pathname.startsWith("/_vercel") ||
    pathname.includes(".")
  );
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
