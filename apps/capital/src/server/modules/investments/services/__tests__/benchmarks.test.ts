import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { fetchSgs, parseSgs, sgsUrl, type FetchLike } from "../../lib/bcb";
import { benchmarks12m, refreshBenchmarks } from "../benchmarks";

// MarketIndexValue is shared by every user: the test writes under its own series names only.
const NAMES = { cdi: "test-bench-cdi", ipca: "test-bench-ipca" };
const cleanup = () => prisma.marketIndexValue.deleteMany({ where: { series: { in: Object.values(NAMES) } } });

afterAll(cleanup);

const fmt = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const parseBr = (s: string) => {
  const [dd, mm, yyyy] = s.split("/").map(Number);
  return new Date(Date.UTC(yyyy, mm - 1, dd));
};

/** A fake SGS: CDI 0.04% on every weekday, IPCA 0.5% a month; answers 404 on an empty window like the real API. */
function fakeSgs() {
  return vi.fn<FetchLike>(async (url) => {
    const u = new URL(url);
    const code = Number(/sgs\.(\d+)/.exec(u.pathname)![1]);
    const from = parseBr(u.searchParams.get("dataInicial")!);
    const to = parseBr(u.searchParams.get("dataFinal")!);
    const rows: { data: string; valor: string }[] = [];
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) {
      if (code === 12 && d.getUTCDay() !== 0 && d.getUTCDay() !== 6) rows.push({ data: fmt(d), valor: "0.040000" });
      if (code === 433 && d.getUTCDate() === 1) rows.push({ data: fmt(d), valor: "0.50" });
    }
    return rows.length ? { ok: true, status: 200, json: async () => rows } : { ok: false, status: 404, json: async () => ({}) };
  });
}

describe("BCB SGS", () => {
  it("builds the URL and parses the series", () => {
    expect(sgsUrl(12, new Date(Date.UTC(2026, 0, 2)), new Date(Date.UTC(2026, 9, 6)))).toBe(
      "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=02/01/2026&dataFinal=06/10/2026"
    );
    expect(parseSgs([{ data: "02/01/2026", valor: "0.055131" }, { data: "x", valor: "1" }, { data: "05/01/2026", valor: "" }])).toEqual([
      { date: new Date(Date.UTC(2026, 0, 2)), value: 0.055131 },
    ]);
    expect(() => parseSgs({ erro: "x" })).toThrow();
  });

  it("treats 404 as no values and other failures as errors", async () => {
    const at = new Date(Date.UTC(2026, 0, 3));
    expect(await fetchSgs(12, at, at, async () => ({ ok: false, status: 404, json: async () => ({}) }))).toEqual([]);
    await expect(fetchSgs(12, at, at, async () => ({ ok: false, status: 500, json: async () => ({}) }))).rejects.toThrow(/HTTP 500/);
  });

  it("retries once after a timeout", async () => {
    const at = new Date(Date.UTC(2026, 0, 2));
    let calls = 0;
    const flaky: FetchLike = async () => {
      if (++calls === 1) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      return { ok: true, status: 200, json: async () => [{ data: "02/01/2026", valor: "0.05" }] };
    };
    expect(await fetchSgs(12, at, at, flaky)).toEqual([{ date: at, value: 0.05 }]);
    expect(calls).toBe(2);
    const down: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(fetchSgs(12, at, at, down)).rejects.toThrow(/fetch failed/);
  });
});

describe("benchmarks", () => {
  it("caches the series incrementally and compounds the last 12 months", async () => {
    await cleanup();
    const now = new Date("2026-10-06T10:00:00Z");
    const fetchImpl = fakeSgs();
    const first = await refreshBenchmarks(prisma, { fetchImpl, now, names: NAMES });
    expect(first.map((r) => [r.series, r.error ?? null])).toEqual([
      ["cdi", null],
      ["ipca", null],
    ]);
    expect(first[0].stored).toBeGreaterThan(500);
    // About three years back: Nov/23 to Oct/26.
    expect(first[1].stored).toBe(36);

    // The next day only the new CDI day is fetched; IPCA's last months are fetched again and overwritten.
    const next = await refreshBenchmarks(prisma, { fetchImpl, now: new Date("2026-10-07T10:00:00Z"), names: NAMES });
    expect(next[0]).toMatchObject({ fetched: 1, stored: 1 });
    expect(fetchImpl.mock.calls.at(-2)![0]).toContain("dataInicial=07/10/2026");
    expect(await prisma.marketIndexValue.count({ where: { series: NAMES.ipca } })).toBe(36);

    const b = await benchmarks12m(prisma, now, NAMES);
    const cdiDays = await prisma.marketIndexValue.count({ where: { series: NAMES.cdi, date: { gt: new Date(Date.UTC(2025, 9, 6)), lte: new Date(Date.UTC(2026, 9, 6)) } } });
    expect(b.cdi).toBeCloseTo(1.0004 ** cdiDays - 1, 10);
    expect(b.ipca).toBeCloseTo(1.005 ** 12 - 1, 10);
    expect(b.ipcaPlus6).toBeCloseTo(1.005 ** 12 * 1.06 - 1, 10);
    expect(b).toMatchObject({ cdiAsOf: "2026-10-06", ipcaAsOf: "2026-10-01" });
  });

  it("reports a failing series without stopping the other, and has no benchmark without data", async () => {
    await cleanup();
    const failing: FetchLike = async (url) => (url.includes("sgs.12/") ? { ok: false, status: 503, json: async () => ({}) } : fakeSgs()(url));
    const res = await refreshBenchmarks(prisma, { fetchImpl: failing, now: new Date("2026-10-06T10:00:00Z"), names: NAMES });
    expect(res[0]).toMatchObject({ series: "cdi", stored: 0, error: expect.stringMatching(/503/) });
    expect(res[1].stored).toBeGreaterThan(0);
    expect(await benchmarks12m(prisma, new Date("2026-10-06T10:00:00Z"), NAMES)).toMatchObject({ cdi: null, cdiAsOf: null });
  });
});
