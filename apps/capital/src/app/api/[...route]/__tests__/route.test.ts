import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The catch-all route hands every request the Next.js runtime gives it to the
 * Hono app, for each HTTP method. The app itself is replaced by a spy here;
 * app-surface.test.ts (server/lib) drives the real app.
 */
const app = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@capital/server/app", () => ({ default: app }));

import * as route from "../route";

beforeEach(() => {
  app.fetch.mockReset();
  app.fetch.mockImplementation(async (req: Request) => new Response(JSON.stringify({ seen: `${req.method} ${new URL(req.url).pathname}` }), { status: 202 }));
});

describe("/api/[...route]", () => {
  it.each(["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] as const)("%s passes the very same request to the Hono app and returns its response", async (method) => {
    const handler = route[method];
    const req = new Request("http://localhost/api/v2/anything?x=1", { method, body: method === "GET" || method === "OPTIONS" ? undefined : "{}" });

    const res = await handler(req);

    expect(app.fetch).toHaveBeenCalledTimes(1);
    expect(app.fetch.mock.calls[0][0]).toBe(req);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ seen: `${method} /api/v2/anything` });
  });

  it("is never cached or statically rendered", () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.revalidate).toBe(0);
  });

  it("lets an app failure reach the runtime instead of swallowing it", async () => {
    app.fetch.mockRejectedValue(new Error("app crashed"));
    await expect(route.GET(new Request("http://localhost/api/x"))).rejects.toThrow("app crashed");
  });
});
