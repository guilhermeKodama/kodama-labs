import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, fetchWithTimeout, retryAfterMs } from "../http";

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

  it("maps 401 and 403 to unauthorized without retrying", async () => {
    for (const status of [401, 403]) {
      const fetcher = vi.fn(async () => json({ error: "token required" }, status));
      const result = await fetchJson("https://x.test/q", { fetcher, retries: 2, backoffMs: 1 });
      expect(result).toEqual({ outcome: "unauthorized", status });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchWithTimeout", () => {
  it("uses the global fetch when no fetcher is given, handing it an abort signal", async () => {
    const globalFetch = vi.fn(async () => json({ from: "global" }));
    vi.stubGlobal("fetch", globalFetch);

    const res = await fetchWithTimeout("https://x.test/default", { init: { method: "POST" } });

    expect(await res.json()).toEqual({ from: "global" });
    expect(globalFetch).toHaveBeenCalledTimes(1);
    const [url, init] = globalFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.test/default");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a request that outlives the timeout", async () => {
    const fetcher = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")));
        }),
    );

    await expect(fetchWithTimeout("https://x.test/slow", { fetcher, timeoutMs: 5 })).rejects.toThrow("request aborted");
  });

  it("does not abort a request that answers in time", async () => {
    const seen: AbortSignal[] = [];
    const fetcher = async (_url: string, init?: RequestInit) => {
      seen.push(init!.signal!);
      return json({ ok: true });
    };

    await fetchWithTimeout("https://x.test/fast", { fetcher, timeoutMs: 50 });
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(seen[0].aborted).toBe(false);
  });

  it("passes the caller's own signal through when AbortController does not exist", async () => {
    const own = new AbortController().signal;
    vi.stubGlobal("AbortController", undefined);
    const seen: Array<AbortSignal | null | undefined> = [];
    const fetcher = async (_url: string, init?: RequestInit) => {
      seen.push(init?.signal);
      return json({});
    };

    await fetchWithTimeout("https://x.test/legacy", { fetcher, init: { signal: own } });

    expect(seen).toEqual([own]);
  });
});

describe("fetchJson defaults and error shapes", () => {
  it("reports a timeout as provider_down once the attempts are spent", async () => {
    const fetcher = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("timed out")));
        }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await fetchJson("https://x.test/slow", { fetcher, timeoutMs: 5, retries: 1, backoffMs: 1, label: "[Quotes] slow" });

    expect(result).toEqual({ outcome: "provider_down", status: null, error: "timed out" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[Quotes] slow: attempt 1/2 failed (timed out)"));
  });

  it("names the url in the retry log when no label is given", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockResolvedValueOnce(json({}, 502)).mockResolvedValueOnce(json({ ok: 1 }));

    const result = await fetchJson("https://x.test/flaky", { fetcher, backoffMs: 1 });

    expect(result).toMatchObject({ outcome: "ok", data: { ok: 1 } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("https://x.test/flaky: attempt 1/3 failed (HTTP 502), retrying"));
  });

  it("stringifies a network failure that is not an Error", async () => {
    const fetcher = vi.fn(async () => {
      throw "socket closed";
    });
    const result = await fetchJson("https://x.test/a", { fetcher, retries: 0 });
    expect(result).toEqual({ outcome: "provider_down", status: null, error: "socket closed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("falls back to the global fetch and the default retry budget", async () => {
    const globalFetch = vi.fn(async () => json({ price: 7 }));
    vi.stubGlobal("fetch", globalFetch);
    const result = await fetchJson<{ price: number }>("https://x.test/g");
    expect(result).toEqual({ outcome: "ok", data: { price: 7 }, status: 200 });
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });

  it("gives schema_changed a generic reason when the body cannot be read and the error is not an Error", async () => {
    const broken = { ok: true, status: 200, headers: new Headers(), json: async () => Promise.reject("garbled") } as unknown as Response;
    const result = await fetchJson("https://x.test/b", { fetcher: async () => broken });
    expect(result).toEqual({ outcome: "schema_changed", status: 200, error: "invalid JSON" });
  });

  it("maps a parse that returns null to schema_changed 'unexpected response shape'", async () => {
    const fetcher = vi.fn(async () => json({ unexpected: true }));
    const result = await fetchJson("https://x.test/c", { fetcher, parse: () => null });
    expect(result).toEqual({ outcome: "schema_changed", status: 200, error: "unexpected response shape" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps a parse that throws a non-Error to the same generic reason", async () => {
    const result = await fetchJson("https://x.test/d", {
      fetcher: async () => json({}),
      parse: () => {
        throw "bad shape";
      },
    });
    expect(result).toEqual({ outcome: "schema_changed", status: 200, error: "unexpected response shape" });
  });

  it("returns what a successful parse produced", async () => {
    const result = await fetchJson<number>("https://x.test/e", { fetcher: async () => json({ price: 12.5 }), parse: (body) => (body as { price: number }).price });
    expect(result).toEqual({ outcome: "ok", data: 12.5, status: 200 });
  });

  it("warns about a refused credential and does not retry it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetcher = vi.fn(async () => json({}, 401));
    const result = await fetchJson("https://x.test/f", { fetcher, label: "[Brapi]" });
    expect(result).toEqual({ outcome: "unauthorized", status: 401 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[Brapi]: refused (HTTP 401)"));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports rate_limited with no wait when Retry-After is absent", async () => {
    const fetcher = vi.fn(async () => json({}, 429));
    const result = await fetchJson("https://x.test/g", { fetcher, backoffMs: 1 });
    expect(result).toEqual({ outcome: "rate_limited", status: 429, retryAfterMs: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports rate_limited on the last attempt even when the wait is small", async () => {
    const fetcher = vi.fn(async () => json({}, 429, { "retry-after": "0" }));
    const result = await fetchJson("https://x.test/h", { fetcher, retries: 1, backoffMs: 1 });
    expect(result).toEqual({ outcome: "rate_limited", status: 429, retryAfterMs: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
