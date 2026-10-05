import { afterEach, describe, expect, it, vi } from "vitest";
import { cronMonitorName, pushToken } from "@infrastructure/monitoring/push-token";
import { pushHeartbeat } from "./heartbeat";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.KUMA_PUSH_BASE_URL;
  delete process.env.KUMA_PUSH_TOKEN_SECRET;
  delete process.env.KUMA_PUSH_TOKEN_FILE;
});

describe("pushHeartbeat", () => {
  it("does nothing when Kuma is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await pushHeartbeat("capital", "/api/cron/send-reminders", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not push status=down for a single failure", async () => {
    process.env.KUMA_PUSH_BASE_URL = "http://uptime-kuma:3001";
    process.env.KUMA_PUSH_TOKEN_SECRET = "secret";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await pushHeartbeat("capital", "/api/cron/send-reminders", false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pushes status=up with the shared token", async () => {
    process.env.KUMA_PUSH_BASE_URL = "http://uptime-kuma:3001/";
    process.env.KUMA_PUSH_TOKEN_SECRET = "secret";
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await pushHeartbeat("capital", "/api/cron/send-reminders", true);
    const name = cronMonitorName("capital", "/api/cron/send-reminders");
    const token = pushToken("secret", name);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://uptime-kuma:3001/api/push/${token}?status=up&msg=ok&ping=`,
    );
  });
});
