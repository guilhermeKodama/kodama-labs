import { describe, it, expect } from "vitest";
import { isExcludedPath, middlewareConfig } from "../lib/middleware-helpers";

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
});
