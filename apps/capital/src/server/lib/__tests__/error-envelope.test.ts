import { createRoute, z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createTestApp } from "@capital/server/lib/create-app";
import { createRouter } from "@capital/server/lib/router";
import { jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { LedgerError, notFound } from "@capital/server/modules/ledger/lib/errors";

/**
 * The error envelope end to end: a throwaway router mounted on the real app,
 * so the router's validation hook, v2Handler's toHttp and the app's onError
 * all run. Nothing here touches the database.
 */
const failRoute = createRoute({
  method: "post",
  path: "/test-envelope/{kind}",
  request: { params: z.object({ kind: z.string() }), ...jsonBody(z.object({ amount: z.number().positive(), tags: z.array(z.string()).optional() })) },
  responses: v2Responses,
});

const router = createRouter();
router.use("/test-envelope/*", async (c, next) => {
  c.set("userId", "envelope-test-user");
  await next();
});
router.openapi(
  failRoute,
  v2Handler(failRoute, async (c) => {
    switch (c.req.valid("param").kind) {
      case "archived":
        throw new LedgerError('Category "Mercado" is archived and cannot be assigned', 422, { code: "category.archived", params: { name: "Mercado" } });
      case "missing":
        throw notFound("View", "view.not_found");
      case "zod":
        throw new ZodError([{ code: "custom", path: ["rows", 0, "date"], message: "Bad date" }]);
      case "plain-not-found":
        throw new Error("Currency not found");
      case "boom":
        throw new Error("boom");
      default:
        return { ok: true };
    }
  })
);

const app = createTestApp(router);

async function post(kind: string, body: unknown) {
  const res = await app.request(`/api/test-envelope/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("v2 error envelope", () => {
  it("sends a LedgerError's status, English message, code and params", async () => {
    const res = await post("archived", { amount: 1 });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ message: 'Category "Mercado" is archived and cannot be assigned', code: "category.archived", params: { name: "Mercado" } });
  });

  it("omits params when the code has none, and never sends a stack for a 4xx", async () => {
    const res = await post("missing", { amount: 1 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "View not found", code: "view.not_found" });
  });

  it("answers an invalid body with 422, code validation and one issue per failed check", async () => {
    const res = await post("ok", { amount: -1, tags: [3] });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "validation" });
    expect(res.body.message).toEqual(expect.stringContaining("amount"));
    expect(res.body.issues).toEqual(
      expect.arrayContaining([
        { path: "amount", code: "too_small", message: expect.any(String) },
        { path: "tags.0", code: "invalid_type", message: expect.any(String) },
      ])
    );
    expect(Object.keys(res.body).sort()).toEqual(["code", "issues", "message"]);
  });

  it("maps a ZodError thrown by a service to the same validation envelope", async () => {
    const res = await post("zod", { amount: 1 });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ message: "rows.0.date: Bad date", code: "validation", issues: [{ path: "rows.0.date", code: "custom", message: "Bad date" }] });
  });

  it("maps a plain 'not found' error to 404 not_found", async () => {
    const res = await post("plain-not-found", { amount: 1 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Currency not found", code: "not_found" });
  });

  it("keeps unexpected errors as 500 without a code", async () => {
    const res = await post("boom", { amount: 1 });
    expect(res.status).toBe(500);
    expect(res.body.message).toBe("boom");
    expect(res.body.code).toBeUndefined();
  });

  it("answers an unknown route with 404 not_found", async () => {
    const res = await app.request("/api/test-envelope-nowhere");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Not Found - /api/test-envelope-nowhere", code: "not_found" });
  });

  it("answers a request without a session with auth.required", async () => {
    const res = await app.request("/api/v2/views");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "Authentication required", code: "auth.required" });
  });
});
