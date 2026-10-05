import { NextResponse, type NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { isExcludedPath } from "./lib/middleware-helpers";

// Public routes that don't require authentication
const publicRoutes = ["/login", "/signup"];

// Cookie name must match the one used in auth routes
const SESSION_COOKIE_NAME = "capital_session";

// Create the i18n middleware
const intlMiddleware = createIntlMiddleware(routing);

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for API routes, MCP endpoint, static files, and Next.js internals
  if (isExcludedPath(pathname)) {
    return NextResponse.next();
  }

  // Get the locale from the URL or use default
  const locale = routing.locales.find(
    (loc) => pathname.startsWith(`/${loc}/`) || pathname === `/${loc}`
  );

  // Remove locale prefix to check the actual path
  const pathWithoutLocale = locale
    ? pathname.replace(`/${locale}`, "") || "/"
    : pathname;

  // Check if this is a public route
  const isPublicRoute = publicRoutes.some(
    (route) => pathWithoutLocale === route
  );

  // Get session cookie
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  const hasSession = !!sessionCookie?.value;

  if (pathWithoutLocale === "/") {
    const dest = hasSession ? "/transactions" : "/login";
    return NextResponse.redirect(new URL(locale ? `/${locale}${dest}` : dest, request.url));
  }

  // If authenticated user tries to access login/signup, redirect into the app
  if (hasSession && (pathWithoutLocale === "/login" || pathWithoutLocale === "/signup")) {
    const nextUrl = new URL(locale ? `/${locale}/transactions` : "/transactions", request.url);
    return NextResponse.redirect(nextUrl);
  }

  // If not authenticated and trying to access protected route, redirect to login
  if (!isPublicRoute && !hasSession) {
    const loginUrl = new URL(
      locale ? `/${locale}/login` : "/login",
      request.url
    );
    // Store the original URL to redirect back after login
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Apply i18n middleware
  return intlMiddleware(request);
}

export const config = {
  matcher: [
    // Match all paths...
    "/(.*)",
    // Except root
    "/",
  ],
};
