import { describe, expect, it } from "vitest";
import { createApp } from "@capital/server/lib/create-app";

const app = createApp();

describe("health probes, against the real app and database", () => {
  it("GET /api/health answers ok without a session once the database responds", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("GET /api/v1/health reports the API as healthy with a timestamp and a version, without a session", async () => {
    const before = Date.now();
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", timestamp: expect.any(String), version: "1.0.0" });
    const at = new Date(body.timestamp).getTime();
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
