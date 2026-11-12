import { afterEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@capital/server/lib/prisma";
import type { FetchLike } from "../../lib/bcb";
import { refreshBenchmarks } from "../benchmarks";

/**
 * MarketIndexValue is shared by every user and the default series are the real "cdi" and "ipca",
 * so these tests run against an in-memory stand-in for the table and never write to the database.
 */
function fakeCache(last: { cdi?: Date; ipca?: Date } = {}) {
  const findFirst = vi.fn(async ({ where }: { where: { series: string } }) => {
    const date = last[where.series as "cdi" | "ipca"];
    return date ? { date } : null;
  });
  const createMany = vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  const upsert = vi.fn(async () => ({}));
  return { db: { marketIndexValue: { findFirst, createMany, upsert } } as unknown as DbClient, findFirst, createMany, upsert };
}

const ok = (rows: { data: string; valor: string }[]): Awaited<ReturnType<FetchLike>> => ({ ok: true, status: 200, json: async () => rows });

afterEach(() => {
  vi.useRealTimers();
});

describe("refreshBenchmarks defaults", () => {
  it("stores the real series names, and reads the clock for the end of the window when none is given", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T15:30:00Z"));
    const cache = fakeCache();
    const fetchImpl = vi.fn<FetchLike>(async (url) => (url.includes("sgs.12/") ? ok([{ data: "11/11/2026", valor: "0.04" }]) : ok([{ data: "01/10/2026", valor: "0.5" }])));

    const results = await refreshBenchmarks(cache.db, { fetchImpl });

    expect(results).toEqual([
      { series: "cdi", fetched: 1, stored: 1 },
      { series: "ipca", fetched: 1, stored: 1 },
    ]);
    expect(cache.findFirst.mock.calls.map(([args]) => args.where.series)).toEqual(["cdi", "ipca"]);
    expect(cache.createMany).toHaveBeenCalledWith({ data: [{ series: "cdi", date: new Date(Date.UTC(2026, 10, 11)), value: 0.04 }], skipDuplicates: true });
    expect(cache.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { series: "ipca", date: new Date(Date.UTC(2026, 9, 1)), value: 0.5 } }));
    // Every request ends today.
    expect(fetchImpl.mock.calls.every(([url]) => url.includes("dataFinal=12/11/2026"))).toBe(true);
  });

  it("does not ask for a series that is already cached up to today, and still refetches the last months of the other", async () => {
    const now = new Date("2026-11-12T15:30:00Z");
    const cache = fakeCache({ cdi: new Date(Date.UTC(2026, 10, 12)), ipca: new Date(Date.UTC(2026, 10, 12)) });
    const fetchImpl = vi.fn<FetchLike>(async () => ok([]));

    const results = await refreshBenchmarks(cache.db, { fetchImpl, now });

    expect(results[0]).toEqual({ series: "cdi", fetched: 0, stored: 0 });
    expect(results[1]).toEqual({ series: "ipca", fetched: 0, stored: 0 });
    // Only the IPCA window (100 days back) went out.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain("sgs.433/");
    expect(fetchImpl.mock.calls[0][0]).toContain("dataInicial=04/08/2026");
  });

  it("reports the text of a failure that is not an Error, and goes on with the other series", async () => {
    const cache = fakeCache();
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      if (url.includes("sgs.12/")) return Promise.reject("connection refused");
      return ok([{ data: "01/10/2026", valor: "0.5" }]);
    });
    const results = await refreshBenchmarks(cache.db, { fetchImpl, now: new Date("2026-11-12T15:30:00Z") });
    expect(results[0]).toEqual({ series: "cdi", fetched: 0, stored: 0, error: "connection refused" });
    expect(results[1]).toMatchObject({ series: "ipca", fetched: 1, stored: 1 });
    expect(cache.createMany).not.toHaveBeenCalled();
  });
});
