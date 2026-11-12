import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const envOverrides = vi.hoisted(() => ({
  values: {
    VAPID_PRIVATE_KEY: "private-key" as string | undefined,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public-key" as string | undefined,
    VAPID_SUBJECT: "mailto:ops@example.com" as string | undefined,
  } as Record<string, string | undefined>,
}));
vi.mock("@/env", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/env")>();
  return { ...real, env: new Proxy(real.env, { get: (target, prop, receiver) => (typeof prop === "string" && prop in envOverrides.values ? envOverrides.values[prop] : Reflect.get(target, prop, receiver)) }) };
});

const webpush = vi.hoisted(() => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn() }));
vi.mock("web-push", () => ({ default: webpush }));

import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";
import { isPushConfigured, sendToSubscriptions, type PushPayload } from "../web-push";

const USER = "test-user-web-push-001";
const PAYLOAD: PushPayload = { title: "Fatura fechou", body: "R$ 10,00", tag: "bill-1", url: "/transactions" };

beforeEach(async () => {
  envOverrides.values.VAPID_PRIVATE_KEY = "private-key";
  envOverrides.values.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key";
  webpush.sendNotification.mockReset();
  await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

async function subscription(name: string) {
  return prisma.pushSubscription.create({ data: { userId: USER, endpoint: `https://push.example/${name}`, p256dh: `p256dh-${name}`, auth: `auth-${name}` } });
}

describe("VAPID setup", () => {
  it("registers the key pair and subject once when the module loads with both keys", () => {
    // The import at the top of this file ran with both keys set.
    expect(webpush.setVapidDetails).toHaveBeenCalledTimes(1);
    expect(webpush.setVapidDetails).toHaveBeenCalledWith("mailto:ops@example.com", "public-key", "private-key");
  });

  it("does not register anything when a key is missing", async () => {
    webpush.setVapidDetails.mockClear();
    vi.resetModules();
    envOverrides.values.VAPID_PRIVATE_KEY = undefined;
    await import("../web-push");
    expect(webpush.setVapidDetails).not.toHaveBeenCalled();

    vi.resetModules();
    envOverrides.values.VAPID_PRIVATE_KEY = "private-key";
    envOverrides.values.NEXT_PUBLIC_VAPID_PUBLIC_KEY = undefined;
    await import("../web-push");
    expect(webpush.setVapidDetails).not.toHaveBeenCalled();
  });
});

describe("isPushConfigured", () => {
  it("needs both the private and the public key", () => {
    expect(isPushConfigured()).toBe(true);
    envOverrides.values.VAPID_PRIVATE_KEY = undefined;
    expect(isPushConfigured()).toBe(false);
    envOverrides.values.VAPID_PRIVATE_KEY = "private-key";
    envOverrides.values.NEXT_PUBLIC_VAPID_PUBLIC_KEY = undefined;
    expect(isPushConfigured()).toBe(false);
  });
});

describe("sendToSubscriptions", () => {
  it("sends nothing without keys or without subscriptions", async () => {
    const sub = await subscription("a");
    expect(await sendToSubscriptions([], PAYLOAD)).toEqual({ sent: 0, failed: 0 });
    envOverrides.values.VAPID_PRIVATE_KEY = undefined;
    expect(await sendToSubscriptions([sub], PAYLOAD)).toEqual({ sent: 0, failed: 0 });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it("sends the JSON payload to every subscription with its keys", async () => {
    const a = await subscription("a");
    const b = await subscription("b");
    webpush.sendNotification.mockResolvedValue({ statusCode: 201 });

    const result = await sendToSubscriptions([a, b], PAYLOAD);

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    expect(webpush.sendNotification).toHaveBeenCalledWith({ endpoint: a.endpoint, keys: { p256dh: "p256dh-a", auth: "auth-a" } }, JSON.stringify(PAYLOAD));
    expect(webpush.sendNotification).toHaveBeenCalledWith({ endpoint: b.endpoint, keys: { p256dh: "p256dh-b", auth: "auth-b" } }, JSON.stringify(PAYLOAD));
    expect(await prisma.pushSubscription.count({ where: { userId: USER, deadAt: { not: null } } })).toBe(0);
  });

  it("marks a subscription dead when the push service says it is gone (404 or 410), and only that one", async () => {
    const gone = await subscription("gone");
    const expired = await subscription("expired");
    const fine = await subscription("fine");
    webpush.sendNotification.mockImplementation(async (target: { endpoint: string }) => {
      if (target.endpoint === gone.endpoint) throw Object.assign(new Error("Not Found"), { statusCode: 404 });
      if (target.endpoint === expired.endpoint) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return { statusCode: 201 };
    });

    const result = await sendToSubscriptions([gone, expired, fine], PAYLOAD);

    expect(result).toEqual({ sent: 1, failed: 2 });
    const rows = await prisma.pushSubscription.findMany({ where: { userId: USER }, orderBy: { endpoint: "asc" } });
    expect(rows.map((row) => [row.endpoint.split("/").pop(), row.deadAt !== null])).toEqual([["expired", true], ["fine", false], ["gone", true]]);
    expect(rows.find((row) => row.endpoint === gone.endpoint)?.deadAt?.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("counts any other failure as failed without marking the subscription dead", async () => {
    const flaky = await subscription("flaky");
    const down = await subscription("down");
    webpush.sendNotification.mockImplementation(async (target: { endpoint: string }) => {
      if (target.endpoint === flaky.endpoint) throw Object.assign(new Error("Server Error"), { statusCode: 500 });
      throw new Error("socket hang up");
    });

    expect(await sendToSubscriptions([flaky, down], PAYLOAD)).toEqual({ sent: 0, failed: 2 });
    expect(await prisma.pushSubscription.count({ where: { userId: USER, deadAt: { not: null } } })).toBe(0);
  });

  it("still counts a failure when the dead subscription was deleted in the meantime", async () => {
    const vanished = await subscription("vanished");
    const fine = await subscription("fine");
    await prisma.pushSubscription.delete({ where: { id: vanished.id } });
    webpush.sendNotification.mockImplementation(async (target: { endpoint: string }) => {
      if (target.endpoint === vanished.endpoint) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return { statusCode: 201 };
    });

    expect(await sendToSubscriptions([vanished, fine], PAYLOAD)).toEqual({ sent: 1, failed: 1 });
  });
});
