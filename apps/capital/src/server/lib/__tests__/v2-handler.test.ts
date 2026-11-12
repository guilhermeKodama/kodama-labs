import { createRoute, z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { createTestApp } from "@capital/server/lib/create-app";
import { createRouter } from "@capital/server/lib/router";
import { idParams, jsonBody, queryFlag, v2Handler, v2Responses } from "@capital/server/lib/v2";

/**
 * v2Handler on a throwaway router mounted on the real app (session check
 * included, so the router sets the user itself, as error-envelope.test.ts
 * does). Nothing here touches the database.
 */
const route = createRoute({
  method: "post",
  path: "/test-v2-handler/{id}",
  request: { params: idParams, query: z.object({ strict: queryFlag.optional() }), ...jsonBody(z.object({ n: z.number() })) },
  responses: v2Responses,
});

const router = createRouter();
router.use("/test-v2-handler/*", async (c, next) => {
  c.set("userId", "v2-handler-user");
  await next();
});
router.openapi(
  route,
  v2Handler(route, async (c, userId) => {
    const { id } = c.req.valid("param");
    const { strict } = c.req.valid("query");
    switch (id) {
      case "response":
        return new Response("a,b\n1,2\n", { status: 200, headers: { "content-type": "text/csv", "x-user": userId } });
      case "nothing":
        return undefined;
      case "null":
        return null;
      case "echo":
        return { userId, n: c.req.valid("json").n, strict: strict ?? null };
      default:
        throw new Error(`${id} not found`);
    }
  }),
);

const app = createTestApp(router);
const call = (id: string, query = "") =>
  app.request(`/api/test-v2-handler/${id}${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n: 7 }) });

describe("v2Handler", () => {
  it("returns a Response from the handler untouched", async () => {
    const res = await call("response");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv");
    expect(res.headers.get("x-user")).toBe("v2-handler-user");
    expect(await res.text()).toBe("a,b\n1,2\n");
  });

  it("wraps the returned value as JSON 200 and gives the handler the authenticated user", async () => {
    const res = await call("echo");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "v2-handler-user", n: 7, strict: null });
  });

  it("answers { ok: true } when the handler returns nothing", async () => {
    expect(await (await call("nothing")).json()).toEqual({ ok: true });
    expect(await (await call("null")).json()).toEqual({ ok: true });
  });

  it("maps a 'not found' failure to the 404 envelope", async () => {
    const res = await call("ghost");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found", message: "ghost not found" });
  });
});

describe("queryFlag", () => {
  it("reads 'true' and 'false' as booleans, where a coerced boolean would read 'false' as true", async () => {
    expect(queryFlag.parse("true")).toBe(true);
    expect(queryFlag.parse("false")).toBe(false);
    expect(queryFlag.safeParse("yes").success).toBe(false);
    const res = await call("echo", "?strict=false");
    expect(await res.json()).toMatchObject({ strict: false });
  });
});
