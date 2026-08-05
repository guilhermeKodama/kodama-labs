import { NextResponse, type NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="pipeline"' },
  });
}

// Single-user dashboard: HTTP Basic Auth on every page. API routes have their
// own auth (webhook HMAC, SYNC_SECRET, CRON_SECRET, hono basic-auth) and are
// excluded here, matching the sentinel middleware shape.
function checkBasicAuth(request: NextRequest): boolean {
  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!user || !password) return true; // not configured (local dev) → open

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;

  try {
    const decoded = atob(header.slice(6));
    const sep = decoded.indexOf(":");
    if (sep === -1) return false;
    return (
      decoded.slice(0, sep) === user && decoded.slice(sep + 1) === password
    );
  } catch {
    return false;
  }
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/_vercel") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  if (!checkBasicAuth(request)) {
    return unauthorized();
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)", "/"],
};
