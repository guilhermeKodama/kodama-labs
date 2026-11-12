import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ configured: true }));
vi.mock("@capital/server/lib/web-push", () => ({
  isPushConfigured: () => state.configured,
  sendToSubscriptions: vi.fn(async () => ({ sent: 0, failed: 0 })),
}));

import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";
import { subscribeToPush } from "../services/subscribe";
import { unsubscribeFromPush } from "../services/unsubscribe";

const USER = "test-user-push-routes-001";
const OTHER = "test-user-push-routes-002";
const ENDPOINT = "https://push.example/send/abc123";
const app = createApp();

let cookie: string;
let otherCookie: string;

const login = async (userId: string) => `capital_session=${(await prisma.session.create({ data: { userId, expiresAt: new Date(Date.now() + 3600_000) } })).id}`;

async function call(method: string, path: string, body?: unknown, as: string | null = cookie) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { ...(as && { cookie: as }), ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const subscribe = (extra: Record<string, unknown> = {}, as: string | null = cookie) =>
  call("POST", "/v1/push/subscribe", { endpoint: ENDPOINT, keys: { p256dh: "p256dh-key", auth: "auth-key" }, ...extra }, as);

beforeEach(async () => {
  state.configured = true;
  await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
  cookie = await login(USER);
  otherCookie = await login(OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("authentication", () => {
  it("answers 401 to every push route without a session", async () => {
    expect((await call("POST", "/v1/push/subscribe", { endpoint: ENDPOINT, keys: { p256dh: "a", auth: "b" } }, null)).status).toBe(401);
    expect((await call("DELETE", "/v1/push/subscribe", { endpoint: ENDPOINT }, null)).status).toBe(401);
    expect((await call("GET", "/v1/push/status", undefined, null)).status).toBe(401);
    expect(await prisma.pushSubscription.count({ where: { endpoint: ENDPOINT } })).toBe(0);
  });
});

describe("POST /v1/push/subscribe", () => {
  it("stores the subscription for the caller with its keys, label and user agent", async () => {
    const { status, body } = await subscribe({ deviceLabel: "Mac|Chrome", userAgent: "Mozilla/5.0" });

    expect(status).toBe(200);
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: ENDPOINT } });
    expect(body).toEqual({ id: row.id });
    expect(row).toMatchObject({ userId: USER, p256dh: "p256dh-key", auth: "auth-key", deviceLabel: "Mac|Chrome", userAgent: "Mozilla/5.0", deadAt: null });
  });

  it("is an upsert by endpoint: it refreshes the keys and last-seen time and brings a dead subscription back", async () => {
    const first = await subscribe({ deviceLabel: "Mac|Chrome" });
    await prisma.pushSubscription.update({ where: { endpoint: ENDPOINT }, data: { deadAt: new Date(), lastSeenAt: new Date("2026-01-01T00:00:00.000Z") } });

    const again = await subscribe({ keys: { p256dh: "new-p256dh", auth: "new-auth" }, deviceLabel: "Mac|Safari" });

    expect(again.body.id).toBe(first.body.id);
    expect(await prisma.pushSubscription.count({ where: { endpoint: ENDPOINT } })).toBe(1);
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: ENDPOINT } });
    expect(row).toMatchObject({ p256dh: "new-p256dh", auth: "new-auth", deviceLabel: "Mac|Safari", deadAt: null });
    expect(row.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("hands the endpoint to the user who subscribes with it next", async () => {
    await subscribe();
    const taken = await subscribe({}, otherCookie);
    expect(taken.status).toBe(200);
    expect((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: ENDPOINT } })).userId).toBe(OTHER);
    expect(await prisma.pushSubscription.count({ where: { userId: USER } })).toBe(0);
  });

  it("validates the body", async () => {
    for (const bad of [
      { endpoint: "not a url" },
      { keys: { p256dh: "", auth: "b" } },
      { keys: { p256dh: "a", auth: "" } },
      { keys: { p256dh: "a" } },
      { deviceLabel: "x".repeat(101) },
      { userAgent: "x".repeat(501) },
    ]) {
      const res = await subscribe(bad);
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
    expect(await prisma.pushSubscription.count({ where: { endpoint: ENDPOINT } })).toBe(0);
    const noKeys = await call("POST", "/v1/push/subscribe", { endpoint: ENDPOINT });
    expect(noKeys.status).toBe(422);
  });
});

describe("DELETE /v1/push/subscribe", () => {
  it("removes the caller's own subscription", async () => {
    await subscribe();
    expect(await call("DELETE", "/v1/push/subscribe", { endpoint: ENDPOINT })).toEqual({ status: 200, body: { message: "Subscription removed" } });
    expect(await prisma.pushSubscription.count({ where: { endpoint: ENDPOINT } })).toBe(0);
  });

  it("is a quiet no-op for an unknown endpoint, and never removes another user's device", async () => {
    await subscribe();
    expect((await call("DELETE", "/v1/push/subscribe", { endpoint: "https://push.example/unknown" })).status).toBe(200);
    expect((await call("DELETE", "/v1/push/subscribe", { endpoint: ENDPOINT }, otherCookie)).status).toBe(200);
    expect((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: ENDPOINT } })).userId).toBe(USER);
  });

  it("validates the endpoint", async () => {
    expect((await call("DELETE", "/v1/push/subscribe", { endpoint: "nope" })).status).toBe(422);
    expect((await call("DELETE", "/v1/push/subscribe", {})).status).toBe(422);
  });
});

describe("GET /v1/push/status", () => {
  it("counts the caller's live devices only and says whether the server can push", async () => {
    expect(await call("GET", "/v1/push/status")).toEqual({ status: 200, body: { configured: true, deviceCount: 0 } });
    await prisma.pushSubscription.createMany({
      data: [
        { userId: USER, endpoint: "https://push.example/1", p256dh: "k", auth: "a" },
        { userId: USER, endpoint: "https://push.example/2", p256dh: "k", auth: "a" },
        { userId: USER, endpoint: "https://push.example/3", p256dh: "k", auth: "a", deadAt: new Date() },
        { userId: OTHER, endpoint: "https://push.example/4", p256dh: "k", auth: "a" },
      ],
    });
    state.configured = false;

    expect(await call("GET", "/v1/push/status")).toEqual({ status: 200, body: { configured: false, deviceCount: 2 } });
    expect((await call("GET", "/v1/push/status", undefined, otherCookie)).body.deviceCount).toBe(1);
  });
});

describe("push services", () => {
  it("subscribeToPush and unsubscribeFromPush work on the database directly", async () => {
    const created = await subscribeToPush(USER, { endpoint: ENDPOINT, p256dh: "k", auth: "a", deviceLabel: "Label" }, prisma);
    expect(created).toMatchObject({ userId: USER, endpoint: ENDPOINT, deviceLabel: "Label" });
    await unsubscribeFromPush(OTHER, ENDPOINT, prisma);
    expect(await prisma.pushSubscription.count({ where: { endpoint: ENDPOINT } })).toBe(1);
    await unsubscribeFromPush(USER, ENDPOINT, prisma);
    expect(await prisma.pushSubscription.count({ where: { endpoint: ENDPOINT } })).toBe(0);
  });
});
