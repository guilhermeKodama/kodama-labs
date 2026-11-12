import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.hoisted(() => vi.fn());
vi.mock("@capital/server/lib/prisma", () => ({ prisma: { $queryRaw: queryRaw } }));

import dbHealth from "../db";

const get = () => dbHealth.request("/health");

beforeEach(() => {
  queryRaw.mockReset();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /health", () => {
  it("answers 200 once the database answers a SELECT 1, and leaves no timer behind", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(String((queryRaw.mock.calls[0]![0] as string[]).join(""))).toBe("SELECT 1");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("answers 503 when the query fails, whatever it throws", async () => {
    queryRaw.mockRejectedValueOnce(new Error("connection refused"));
    const failed = await get();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ status: "error", db: "error" });

    queryRaw.mockRejectedValueOnce("not an Error object");
    const odd = await get();
    expect(odd.status).toBe(503);
    expect(await odd.json()).toEqual({ status: "error", db: "error" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("answers 503 after three seconds without an answer, and does not stack a second query while the first hangs", async () => {
    let release: () => void = () => {};
    queryRaw.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));

    const pending = get();
    await vi.advanceTimersByTimeAsync(2_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error", db: "error" });

    // The hung query is still in flight, so the next check shares it instead of opening another.
    queryRaw.mockResolvedValue([]);
    const sharing = get();
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await sharing).status).toBe(503);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    // Once the hung query finally settles, the next check asks the database again.
    release();
    await vi.advanceTimersByTimeAsync(0);
    const recovered = await get();
    expect(recovered.status).toBe(200);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("shares one query between simultaneous checks", async () => {
    let release: () => void = () => {};
    queryRaw.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));

    const first = get();
    const second = get();
    await vi.advanceTimersByTimeAsync(0);
    release();
    const [a, b] = await Promise.all([first, second]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
