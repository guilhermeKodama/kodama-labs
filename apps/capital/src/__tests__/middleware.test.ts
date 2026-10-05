import { describe, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import middleware from "../middleware";
import { isExcludedPath, loginPath, middlewareConfig, safeRedirect, stripLocalePrefix } from "../lib/middleware-helpers";

// next-intl's middleware is ESM that imports "next/server" without an
// extension, which plain Node (vitest loads node_modules unbundled) cannot
// resolve. It is stubbed: each test sees the request it would get and the
// routing it was created with, and answers with a marker response.
const intl = vi.hoisted(() => ({ routing: null as unknown, requests: [] as Request[] }));
vi.mock("next-intl/middleware", () => ({
  default: (routing: unknown) => {
    intl.routing = routing;
    return (request: Request) => {
      intl.requests.push(request);
      return NextResponse.next({ headers: { "x-test-intl": "1" } });
    };
  },
}));

describe("Middleware", () => {
  describe("isExcludedPath helper", () => {
    it("should exclude /mcp (exact)", () => {
      expect(isExcludedPath("/mcp")).toBe(true);
    });

    it("should exclude /mcp/ with trailing slash", () => {
      expect(isExcludedPath("/mcp/")).toBe(true);
    });

    it("should exclude /mcp/subpath", () => {
      expect(isExcludedPath("/mcp/foo")).toBe(true);
    });

    it("should exclude /api routes", () => {
      expect(isExcludedPath("/api/something")).toBe(true);
    });

    it("should exclude /_next internals", () => {
      expect(isExcludedPath("/_next/static")).toBe(true);
    });

    it("does not special-case /_vercel", () => {
      expect(isExcludedPath("/_vercel/insights")).toBe(false);
    });

    it("keeps the matcher aimed at app routes", () => {
      expect(middlewareConfig.matcher).toEqual(["/(.*)", "/"]);
    });

    it("should exclude paths with dots (static files)", () => {
      expect(isExcludedPath("/favicon.ico")).toBe(true);
      expect(isExcludedPath("/image.png")).toBe(true);
    });

    it("should NOT exclude /dashboard (protected route)", () => {
      expect(isExcludedPath("/dashboard")).toBe(false);
    });

    it("should NOT exclude /pt-BR/dashboard", () => {
      expect(isExcludedPath("/pt-BR/dashboard")).toBe(false);
    });

    it("should NOT exclude /login", () => {
      expect(isExcludedPath("/login")).toBe(false);
    });

    it("should NOT exclude /signup", () => {
      expect(isExcludedPath("/signup")).toBe(false);
    });

    it("should NOT exclude /mcpfoo (not the mcp endpoint)", () => {
      expect(isExcludedPath("/mcpfoo")).toBe(false);
    });
  });

  describe("stripLocalePrefix", () => {
    const locales = ["pt-BR", "en"];

    it("splits a leading locale off", () => {
      expect(stripLocalePrefix("/en/transactions", locales)).toEqual({ locale: "en", path: "/transactions" });
      expect(stripLocalePrefix("/pt-BR", locales)).toEqual({ locale: "pt-BR", path: "/" });
    });

    it("leaves unprefixed paths alone", () => {
      expect(stripLocalePrefix("/transactions", locales)).toEqual({ locale: null, path: "/transactions" });
      expect(stripLocalePrefix("/english", locales)).toEqual({ locale: null, path: "/english" });
      expect(stripLocalePrefix("/", locales)).toEqual({ locale: null, path: "/" });
    });
  });

  describe("safeRedirect and loginPath", () => {
    it("keeps paths of this app, query included", () => {
      expect(safeRedirect("/transactions?view=seed%3Air")).toBe("/transactions?view=seed%3Air");
      expect(safeRedirect("/settings")).toBe("/settings");
    });

    it("falls back to /transactions for anything else", () => {
      for (const value of [null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "transactions", "/", "/login", "/signup?x=1"]) {
        expect(safeRedirect(value), String(value)).toBe("/transactions");
      }
    });

    it("refuses paths the browser would resolve to another origin", () => {
      // URL parsing drops tabs and newlines and reads "\" as "/": each of these is https://evil.example/.
      for (const value of ["/\t/evil.example", "/\n/evil.example", "/\r\n/evil.example", "/\t\\evil.example"]) {
        expect(new URL(value, "https://capital.example").host, JSON.stringify(value)).toBe("evil.example");
        expect(safeRedirect(value), JSON.stringify(value)).toBe("/transactions");
        expect(loginPath(value), JSON.stringify(value)).toBe("/login");
      }
      // Encoded, they stay a path here.
      expect(safeRedirect("/%09/transactions")).toBe("/%09/transactions");
    });

    it("builds the login URL with the way back", () => {
      expect(loginPath("/transactions?view=a b")).toBe("/login?redirect=%2Ftransactions%3Fview%3Da%20b");
      expect(loginPath("/transactions")).toBe("/login?redirect=%2Ftransactions");
      expect(loginPath("/")).toBe("/login");
      expect(loginPath("//evil.example")).toBe("/login");
      expect(loginPath(null)).toBe("/login");
    });
  });

  describe("middleware", () => {
    const run = (path: string, { session = false, locale, language }: { session?: boolean; locale?: string; language?: string } = {}) => {
      intl.requests.length = 0;
      const headers = new Headers();
      const cookies = [session ? "capital_session=abc" : null, locale ? `NEXT_LOCALE=${locale}` : null].filter(Boolean);
      if (cookies.length) headers.set("cookie", cookies.join("; "));
      if (language) headers.set("accept-language", language);
      return middleware(new NextRequest(new URL(path, "http://localhost:3000"), { headers }));
    };
    const location = (res: Response) => {
      const value = res.headers.get("location");
      return value ? value.replace("http://localhost:3000", "") : null;
    };
    const toIntl = (res: Response) => res.headers.get("x-test-intl") === "1";

    it("sends visitors without a session to login, with the way back", async () => {
      const res = await run("/transactions?view=seed:ir");
      expect(res.status).toBe(307);
      expect(location(res)).toBe("/login?redirect=%2Ftransactions%3Fview%3Dseed%3Air");
    });

    it("sends / to the app or to login", async () => {
      expect(location(await run("/", { session: true }))).toBe("/transactions");
      expect(location(await run("/"))).toBe("/login");
    });

    it("sends a signed-in user away from login and signup", async () => {
      expect(location(await run("/login", { session: true }))).toBe("/transactions");
      expect(location(await run("/signup", { session: true }))).toBe("/transactions");
    });

    it("hands allowed pages to next-intl, which rewrites them to the cookie's locale", async () => {
      expect(toIntl(await run("/login"))).toBe(true);
      expect(toIntl(await run("/transactions?view=x", { session: true, locale: "en" }))).toBe(true);
      expect(intl.requests[0].url).toBe("http://localhost:3000/transactions?view=x");
      expect(intl.requests[0].headers.get("cookie")).toContain("NEXT_LOCALE=en");
      expect(intl.routing).toMatchObject({ localePrefix: "never", defaultLocale: "pt-BR", localeCookie: { name: "NEXT_LOCALE" } });
    });

    it("hides Accept-Language from next-intl, so pt-BR stays the default", async () => {
      expect(toIntl(await run("/transactions", { session: true, language: "en-US,en;q=0.9" }))).toBe(true);
      expect(intl.requests[0].headers.has("accept-language")).toBe(false);
      expect(intl.requests[0].headers.get("cookie")).toContain("capital_session=abc");
    });

    it("lets next-intl unprefix a localized URL before any session check", async () => {
      const res = await run("/en/settings?page=prefs");
      expect(location(res)).toBeNull();
      expect(toIntl(res)).toBe(true);
      expect(intl.requests[0].url).toBe("http://localhost:3000/en/settings?page=prefs");
    });

    it("leaves API routes, MCP and files alone", async () => {
      for (const path of ["/api/v2/me", "/mcp", "/favicon.ico"]) {
        const res = await run(path);
        expect(location(res), path).toBeNull();
        expect(toIntl(res), path).toBe(false);
      }
    });
  });
});
