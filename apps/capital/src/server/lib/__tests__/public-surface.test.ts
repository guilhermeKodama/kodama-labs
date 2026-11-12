import { describe, expect, it } from "vitest";
import { createApp } from "../create-app";

/**
 * The API is on the internet without Cloudflare Access in front, so every
 * route documented in OpenAPI answers 401 to a request without a session,
 * except the ones below, which are public on purpose. A new public route
 * has to be added here, where a reviewer sees it.
 */
const PUBLIC = new Set([
  "POST /api/v2/auth/login",
  "POST /api/v2/auth/signup", // closed unless SIGNUP_OPEN (auth-public.test.ts)
  "POST /api/v2/auth/logout",
  "GET /api/v1/health",
]);

const app = createApp();
const doc = app.getOpenAPIDocument({ openapi: "3.0.0", info: { title: "Cerne API", version: "1.0.0" } });
const operations = Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
  Object.keys(item ?? {})
    .filter((method) => ["get", "post", "put", "patch", "delete"].includes(method))
    .map((method) => ({ method: method.toUpperCase(), path })),
);

describe("the API without a session", () => {
  it("documents enough routes for the check to mean something", () => {
    expect(operations.length).toBeGreaterThan(80);
  });

  it("answers 401 on every route that is not public on purpose", async () => {
    const open: string[] = [];
    for (const { method, path } of operations) {
      const key = `${method} ${path}`;
      if (PUBLIC.has(key)) continue;
      const url = path.replace(/\{[^}]+\}/g, "x");
      const res = await app.request(url, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" || method === "DELETE" ? undefined : "{}",
      });
      if (res.status !== 401) open.push(`${key} → ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it("lists only routes that exist", () => {
    const documented = new Set(operations.map(({ method, path }) => `${method} ${path}`));
    expect([...PUBLIC].filter((key) => !documented.has(key))).toEqual([]);
  });
});
