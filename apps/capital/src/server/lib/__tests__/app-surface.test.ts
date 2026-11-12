import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createSession } from "@capital/server/modules/auth/services/session";
import { createApp, createTestApp } from "../create-app";
import { createRouter } from "../router";
import { requireUserId } from "../auth-middleware";

/**
 * The app as a client sees it: the welcome and documentation endpoints, the
 * 404 envelope, and the session check in front of /api/v2 (real sessions in
 * the database).
 */
const USER = "test-user-app-surface-001";
const app = createApp();
let sessionId: string;

/** A router with one protected-style handler that echoes who the middleware says is calling. */
function probeApp() {
  const router = createRouter();
  router.get("/v2/probe-whoami", (c) => c.json({ userId: requireUserId(c) }));
  // /v1 routes outside fire, assistant and push have no session check in front of them.
  router.get("/v1/probe-unguarded", (c) => c.json({ userId: requireUserId(c) }));
  return createTestApp(router);
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({ data: { id: USER, email: `${USER}@example.com`, passwordHash: "x", name: USER } });
  sessionId = await createSession(USER, prisma);
});

afterAll(async () => {
  // Deleting the user cascades its sessions.
  await prisma.user.deleteMany({ where: { id: USER } });
});

describe("welcome and documentation endpoints", () => {
  it("GET /api answers a JSON welcome with the documentation links", async () => {
    const res = await app.request("/api");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: "Welcome to Cerne API",
      description: "Financial management API for international service providers",
      version: "1.0.0",
      documentation: "/api/doc",
      reference: "/api/reference",
    });
  });

  it("GET /api answers a small HTML page to a browser", async () => {
    const res = await app.request("/api", { headers: { accept: "text/html,application/xhtml+xml" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<h1>Cerne API</h1>");
    expect(html).toContain('href="/api/doc"');
    expect(html).toContain('href="/api/reference"');
  });

  it("serves the OpenAPI document, which lists the v2 routes", async () => {
    const res = await app.request("/api/doc");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; info: { title: string; version: string }; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.0.0");
    expect(doc.info).toMatchObject({ title: "Cerne API", version: "1.0.0" });
    expect(Object.keys(doc.paths)).toContain("/api/v2/auth/login");
  });

  it("serves the interactive reference page pointing at the document", async () => {
    const res = await app.request("/api/reference");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("/api/doc");
  });

  it("answers an unknown path with the 404 error envelope", async () => {
    const res = await app.request("/api/no-such-route");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Not Found - /api/no-such-route", code: "not_found" });
  });
});

describe("session check in front of /api/v2", () => {
  it("answers 401 auth.required without a session cookie", async () => {
    const res = await probeApp().request("/api/v2/probe-whoami");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "auth.required" });
  });

  it("answers 401 auth.session_invalid for a session that does not exist", async () => {
    const res = await probeApp().request("/api/v2/probe-whoami", { headers: { cookie: "capital_session=00000000-0000-4000-8000-000000000000" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "auth.session_invalid" });
  });

  it("answers 401 for an expired session and removes it", async () => {
    const expired = await createSession(USER, prisma);
    await prisma.session.update({ where: { id: expired }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    const res = await probeApp().request("/api/v2/probe-whoami", { headers: { cookie: `capital_session=${expired}` } });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "auth.session_invalid" });
    expect(await prisma.session.count({ where: { id: expired } })).toBe(0);
  });

  it("lets a valid session through and exposes its user to the handler", async () => {
    const res = await probeApp().request("/api/v2/probe-whoami", { headers: { cookie: `capital_session=${sessionId}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: USER });
  });

  it("does not guard the auth endpoints", async () => {
    const res = await app.request("/api/v2/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${USER}@example.com`, password: "definitely-not-the-password" }),
    });
    // Reaches the login handler (bad credentials), not the session check.
    expect(res.status).not.toBe(404);
    expect(await res.clone().json()).not.toMatchObject({ code: "auth.required" });
  });
});

describe("requireUserId", () => {
  it("throws 401 auth.required when no middleware set the user", async () => {
    const res = await probeApp().request("/api/v1/probe-unguarded");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "auth.required" });
  });
});
