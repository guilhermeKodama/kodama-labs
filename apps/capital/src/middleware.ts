import { NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { isExcludedPath, loginPath, stripLocalePrefix } from "./lib/middleware-helpers";

// Public routes that don't require authentication
const publicRoutes = ["/login", "/signup"];

// Cookie name must match the one used in auth routes
const SESSION_COOKIE_NAME = "capital_session";

const intlMiddleware = createIntlMiddleware(routing);

/**
 * next-intl picks the locale from the NEXT_LOCALE cookie, then from
 * Accept-Language. The UI language is the user's choice, pt-BR until they
 * make one, so next-intl sees the browser asking for pt-BR. Removing the
 * header is not enough: without a cookie next-intl writes one whenever the
 * locale differs from what Accept-Language asks for, and with no header
 * that is every first visit. That cookie (pt-BR, chosen by nobody) would
 * keep LocaleSync from applying the user's saved language.
 */
function withDefaultLanguage(request: NextRequest): NextRequest {
  if (request.headers.get("accept-language") === routing.defaultLocale) return request;
  const headers = new Headers(request.headers);
  headers.set("accept-language", routing.defaultLocale);
  return new NextRequest(request, { headers });
}

export default async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Skip middleware for API routes, MCP endpoint, static files, and Next.js internals
  if (isExcludedPath(pathname)) {
    return NextResponse.next();
  }

  // URLs carry no locale. A prefixed one (an old bookmark, or the language
  // switch, which navigates to /en/…) is redirected by next-intl to the
  // same path without the prefix, with the cookie set to that locale; the
  // next request goes through the checks below.
  const { locale, path } = stripLocalePrefix(pathname, routing.locales);
  if (locale) {
    return intlMiddleware(request);
  }

  const hasSession = !!request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (path === "/") {
    return NextResponse.redirect(new URL(hasSession ? "/transactions" : "/login", request.url));
  }

  // An authenticated user on login/signup goes into the app
  if (hasSession && publicRoutes.includes(path)) {
    return NextResponse.redirect(new URL("/transactions", request.url));
  }

  // Without a session, protected routes go to login, which returns here afterwards
  if (!hasSession && !publicRoutes.includes(path)) {
    return NextResponse.redirect(new URL(loginPath(`${pathname}${search}`), request.url));
  }

  // Rewrites /transactions to /<locale>/transactions
  return intlMiddleware(withDefaultLanguage(request));
}

export const config = {
  matcher: [
    // Match all paths...
    "/(.*)",
    // Except root
    "/",
  ],
};
