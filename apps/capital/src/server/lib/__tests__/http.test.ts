import { describe, expect, it, vi } from "vitest";
import { fetchJson, retryAfterMs } from "../http";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("retryAfterMs", () => {
  it("reads seconds", () => {
    expect(retryAfterMs("5")).toBe(5000);
  });

  it("reads an HTTP-date relative to now", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(retryAfterMs("Thu, 01 Jan 2026 00:00:10 GMT", now)).toBe(10_000);
  });

  it("is null for nothing or garbage", () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("not a date")).toBeNull();
  });
});

describe("fetchJson", () => {
  it("returns ok with the parsed body on the first try", async () => {
    const fetcher = vi.fn(async () => json({ price: 10 }));
    const result = await fetchJson<{ price: number }>("https://x/1", { fetcher, backoffMs: 1 });
    expect(result).toEqual({ outcome: "ok", data: { price: 10 }, status: 200 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps 404 to not_found without retrying", async () => {
    const fetcher = vi.fn(async () => json({}, 404));
    const result = await fetchJson("https://x/1", { fetcher, backoffMs: 1 });
    expect(result).toEqual({ outcome: "not_found", status: 404 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps 429 to rate_limited using Retry-After, retrying once within the budget", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({}, 429, { "retry-after": "0" })).mockResolvedValueOnce(json({ price: 1 }));
    const result = await fetchJson<{ price: number }>("https://x/1", { fetcher, backoffMs: 1 });
    expect(result).toEqual({ outcome: "ok", data: { price: 1 }, status: 200 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("gives up as rate_limited when the wait is beyond the budget", async () => {
    const fetcher = vi.fn(async () => json({}, 429, { "retry-after": "3600" }));
    const result = await fetchJson("https://x/1", { fetcher, backoffMs: 1, maxRetryAfterMs: 1000 });
    expect(result).toEqual({ outcome: "rate_limited", status: 429, retryAfterMs: 3_600_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx and returns provider_down once attempts are spent", async () => {
    const fetcher = vi.fn(async () => json({}, 503));
    const result = await fetchJson("https://x/1", { fetcher, backoffMs: 1, retries: 2 });
    expect(result).toEqual({ outcome: "provider_down", status: 503, error: "HTTP 503" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("retries a network error and succeeds on a later attempt", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(json({ ok: true }));
    const result = await fetchJson("https://x/1", { fetcher, backoffMs: 1 });
    expect(result).toEqual({ outcome: "ok", data: { ok: true }, status: 200 });
  });

  it("reports provider_down with no status after every attempt errors", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("dns fail");
    });
    const result = await fetchJson("https://x/1", { fetcher, backoffMs: 1, retries: 1 });
    expect(result).toEqual({ outcome: "provider_down", status: null, error: "dns fail" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("maps a 2xx with an unparseable body to schema_changed without retrying", async () => {
    const fetcher = vi.fn(async () => new Response("<html>not json</html>", { status: 200 }));
    const result = await fetchJson("https://x/1", { fetcher, backoffMs: 1 });
    expect(result.outcome).toBe("schema_changed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps a 2xx that fails the caller's parse to schema_changed", async () => {
    const fetcher = vi.fn(async () => json({ renamedField: 1 }));
    const parse = (body: unknown) => {
      const value = (body as { price?: number }).price;
      if (typeof value !== "number") throw new Error("missing price");
      return value;
    };
    const result = await fetchJson("https://x/1", { fetcher, backoffMs: 1, parse });
    expect(result).toMatchObject({ outcome: "schema_changed", error: "missing price" });
  });
});
