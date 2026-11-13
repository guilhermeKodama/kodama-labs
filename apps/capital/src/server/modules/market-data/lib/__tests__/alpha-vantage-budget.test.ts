import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { alphaVantageProvider, resetAlphaVantagePacing } from "../../providers/alpha-vantage";
import { ALPHA_VANTAGE_DAILY_CAP, alphaVantageCallDay, reserveAlphaVantageCall } from "../alpha-vantage-budget";

const DAY = new Date("2026-11-13T00:00:00Z");
const NEXT = new Date("2026-11-14T00:00:00Z");

function utcToday(): Date {
  return new Date(`${alphaVantageCallDay(new Date())}T00:00:00Z`);
}

beforeAll(() => {
  process.env.ALPHA_VANTAGE_ENFORCE_BUDGET = "1";
});

afterAll(async () => {
  delete process.env.ALPHA_VANTAGE_ENFORCE_BUDGET;
  await prisma.alphaVantageCallDay.deleteMany({ where: { day: { in: [DAY, NEXT, utcToday()] } } });
});

describe("reserveAlphaVantageCall", () => {
  it("allows 22 calls on a UTC day and refuses the 23rd, then starts again the next day", async () => {
    await prisma.alphaVantageCallDay.deleteMany({ where: { day: { in: [DAY, NEXT] } } });
    const now = new Date("2026-11-13T12:00:00Z");
    const results = await Promise.all(Array.from({ length: 30 }, () => reserveAlphaVantageCall(now)));
    expect(results.filter((r) => r.ok)).toHaveLength(ALPHA_VANTAGE_DAILY_CAP);
    expect(results.filter((r) => !r.ok)).toHaveLength(30 - ALPHA_VANTAGE_DAILY_CAP);
    expect((await prisma.alphaVantageCallDay.findUniqueOrThrow({ where: { day: DAY } })).calls).toBe(ALPHA_VANTAGE_DAILY_CAP);

    const blocked = await reserveAlphaVantageCall(new Date("2026-11-13T23:30:00Z"));
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("expected the cap");
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(30 * 60 * 1000);

    expect(await reserveAlphaVantageCall(new Date("2026-11-14T00:30:00Z"))).toEqual({ ok: true, calls: 1 });
    expect((await prisma.alphaVantageCallDay.findUniqueOrThrow({ where: { day: NEXT } })).calls).toBe(1);
  });

  it("does not call Alpha Vantage once the day's row is already full", async () => {
    const today = utcToday();
    await prisma.alphaVantageCallDay.upsert({ where: { day: today }, create: { day: today, calls: ALPHA_VANTAGE_DAILY_CAP }, update: { calls: ALPHA_VANTAGE_DAILY_CAP } });
    resetAlphaVantagePacing(0);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await alphaVantageProvider.fetchPrices!("SPY", { from: "2026-11-13", to: "2026-11-13" });
      expect(result.outcome).toBe("rate_limited");
      if (result.outcome === "rate_limited") expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await prisma.alphaVantageCallDay.findUniqueOrThrow({ where: { day: today } })).calls).toBe(ALPHA_VANTAGE_DAILY_CAP);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
