import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";

/** GET/PATCH/PUT /v2/notifications/settings and the push device list. */
const USER = "test-user-s6-notif-routes-001";
const OTHER = "test-user-s6-notif-routes-002";
const app = createApp();
let cookie: string;

async function login(userId: string) {
  const session = await prisma.session.create({ data: { userId, expiresAt: new Date(Date.now() + 3600_000) } });
  return `capital_session=${session.id}`;
}

const call = async (path: string, init: { method?: string; body?: unknown; as?: string } = {}) => {
  const res = await app.request(`/api${path}`, {
    method: init.method ?? "GET",
    headers: { cookie: init.as ?? cookie, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, body: await res.json() };
};

beforeEach(async () => {
  await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
  cookie = await login(USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("notification settings", () => {
  it("starts from the mockup defaults without writing a row", async () => {
    const { status, body } = await call("/v2/notifications/settings");
    expect(status).toBe(200);
    expect(body).toMatchObject({ dueEnabled: true, overdueEnabled: true, billClosedEnabled: true, budgetEnabled: true, weeklyEnabled: false, dueDaysBefore: 1, dueHour: 9, budgetThreshold: 0.9, weeklyDow: 1, weeklyHour: 8 });
    expect(typeof body.pushConfigured).toBe("boolean");
    expect(await prisma.notificationSettings.count({ where: { userId: USER } })).toBe(0);
  });

  it("persists a toggle and keeps the other defaults", async () => {
    expect((await call("/v2/notifications/settings", { method: "PATCH", body: { weeklyEnabled: true } })).body.weeklyEnabled).toBe(true);
    expect((await call("/v2/notifications/settings", { method: "PATCH", body: { budgetEnabled: false } })).body).toMatchObject({ weeklyEnabled: true, budgetEnabled: false, dueEnabled: true });
    expect((await call("/v2/notifications/settings")).body).toMatchObject({ weeklyEnabled: true, budgetEnabled: false });
  });

  it("accepts PUT as an alias of PATCH", async () => {
    const { status, body } = await call("/v2/notifications/settings", { method: "PUT", body: { dueHour: 7 } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ dueHour: 7, dueEnabled: true });
    expect((await call("/v2/notifications/settings", { method: "PUT", body: { weeklyHour: 24 } })).status).toBe(422);
  });

  it("rejects unknown fields and out-of-range values", async () => {
    expect((await call("/v2/notifications/settings", { method: "PATCH", body: { weeklyHour: 24 } })).status).toBe(422);
    expect((await call("/v2/notifications/settings", { method: "PATCH", body: { sms: true } })).body.code).toBe("validation");
  });
});

describe("push devices", () => {
  beforeEach(async () => {
    await prisma.pushSubscription.createMany({
      data: [
        { userId: USER, endpoint: `https://push.example/${USER}/mac`, p256dh: "k", auth: "a", deviceLabel: "Mac|Chrome", lastSeenAt: new Date("2026-10-05T12:00:00Z") },
        { userId: USER, endpoint: `https://push.example/${USER}/iphone`, p256dh: "k", auth: "a", deviceLabel: "iPhone|Safari|pwa", lastSeenAt: new Date("2026-10-05T11:12:00Z") },
        { userId: USER, endpoint: `https://push.example/${USER}/dead`, p256dh: "k", auth: "a", deadAt: new Date() },
        { userId: OTHER, endpoint: `https://push.example/${OTHER}/mac`, p256dh: "k", auth: "a" },
      ],
    });
  });

  it("lists the live devices and marks this browser's", async () => {
    const { body } = await call(`/v2/notifications/devices?endpoint=${encodeURIComponent(`https://push.example/${USER}/iphone`)}`);
    expect(body.devices.map((d: { deviceLabel: string; isCurrent: boolean }) => [d.deviceLabel, d.isCurrent])).toEqual([
      ["Mac|Chrome", false],
      ["iPhone|Safari|pwa", true],
    ]);
    expect(body.devices[0]).not.toHaveProperty("endpoint");
  });

  it("removes a device, and only the user's own", async () => {
    const { body } = await call("/v2/notifications/devices");
    const mac = body.devices[0].id;
    expect((await call(`/v2/notifications/devices/${mac}`, { method: "DELETE" })).body).toEqual({ ok: true, id: mac });
    expect((await call("/v2/notifications/devices")).body.devices).toHaveLength(1);
    const foreign = await prisma.pushSubscription.findFirstOrThrow({ where: { userId: OTHER } });
    const denied = await call(`/v2/notifications/devices/${foreign.id}`, { method: "DELETE" });
    expect(denied).toMatchObject({ status: 404, body: { code: "notifications.device_not_found" } });
    expect(await prisma.pushSubscription.count({ where: { id: foreign.id } })).toBe(1);
  });
});
