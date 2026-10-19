import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "super-secret-value-pluggy";

vi.mock("@/env", () => ({
  env: {
    PLUGGY_CLIENT_ID: "client-id-pluggy",
    PLUGGY_CLIENT_SECRET: "super-secret-value-pluggy",
  },
}));

import { createPluggyClient } from "../lib/client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPluggyClient", () => {
  it("fails auth without logging the secret or echoing it in the error", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.clientSecret).toBe(SECRET);
      return new Response(JSON.stringify({ message: `rejected ${SECRET}`, apiKey: "should-not-leak" }), { status: 401 });
    });
    const client = createPluggyClient(fetchImpl as unknown as typeof fetch);
    await expect(client.getItem("11111111-1111-4111-8111-111111111111")).rejects.toThrow("Pluggy authentication failed (401)");
    try {
      await client.getItem("11111111-1111-4111-8111-111111111111");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain("should-not-leak");
    }
    for (const spy of [log, error, info, warn]) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET);
    }
  });
});
