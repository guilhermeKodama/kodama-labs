import { describe, expect, it } from "vitest";
import { acceptPrice } from "../accept-price";

const stock = { currency: "BRL", assetClass: "stocks" as const };

describe("acceptPrice", () => {
  it("accepts a first price with no history", () => {
    expect(acceptPrice({ point: { date: "2026-11-10", close: 38.2, currency: "BRL" }, asset: stock })).toEqual({ status: "ok" });
  });

  it("rejects a currency that doesn't match the asset's", () => {
    const verdict = acceptPrice({ point: { date: "2026-11-10", close: 38.2, currency: "USD" }, asset: stock });
    expect(verdict.status).toBe("rejected");
  });

  it("rejects a non-positive close", () => {
    expect(acceptPrice({ point: { date: "2026-11-10", close: 0, currency: "BRL" }, asset: stock }).status).toBe("rejected");
    expect(acceptPrice({ point: { date: "2026-11-10", close: -5, currency: "BRL" }, asset: stock }).status).toBe("rejected");
  });

  it("rejects a future date", () => {
    const verdict = acceptPrice({ point: { date: "2026-11-20", close: 38.2, currency: "BRL" }, asset: stock, now: new Date("2026-11-10T12:00:00Z") });
    expect(verdict.status).toBe("rejected");
  });

  it("allows a day of slack across time zones", () => {
    const verdict = acceptPrice({ point: { date: "2026-11-11", close: 38.2, currency: "BRL" }, asset: stock, now: new Date("2026-11-10T23:50:00Z") });
    expect(verdict.status).toBe("ok");
  });

  it("accepts a move within the class's jump limit", () => {
    const verdict = acceptPrice({ point: { date: "2026-11-10", close: 41, currency: "BRL" }, asset: stock, previous: { close: 38, status: "ok" } });
    expect(verdict.status).toBe("ok");
  });

  it("marks a move past the jump limit as suspect instead of rejecting it", () => {
    const verdict = acceptPrice({ point: { date: "2026-11-10", close: 60, currency: "BRL" }, asset: stock, previous: { close: 38, status: "ok" } });
    expect(verdict).toMatchObject({ status: "suspect" });
  });

  it("uses a wider jump limit for crypto and a narrower one for FIIs", () => {
    const crypto = { currency: "USD", assetClass: "crypto" as const };
    expect(acceptPrice({ point: { date: "2026-11-10", close: 140, currency: "USD" }, asset: crypto, previous: { close: 100, status: "ok" } }).status).toBe("ok");

    const fii = { currency: "BRL", assetClass: "fii" as const };
    expect(acceptPrice({ point: { date: "2026-11-10", close: 118, currency: "BRL" }, asset: fii, previous: { close: 100, status: "ok" } }).status).toBe("suspect");
  });

  it("confirms a suspect price once a following close lands close to it", () => {
    // Day 1: a real jump (split/re-listing) comes in as "suspect".
    const day1 = acceptPrice({ point: { date: "2026-11-10", close: 60, currency: "BRL" }, asset: stock, previous: { close: 38, status: "ok" } });
    expect(day1.status).toBe("suspect");

    // Day 2: a close near day 1's value confirms it was real, not noise.
    const day2 = acceptPrice({ point: { date: "2026-11-11", close: 61, currency: "BRL" }, asset: stock, previous: { close: 60, status: "suspect" } });
    expect(day2.status).toBe("ok");
  });

  it("keeps flagging a feed that stays far from the last accepted close", () => {
    const day1 = acceptPrice({ point: { date: "2026-11-10", close: 60, currency: "BRL" }, asset: stock, previous: { close: 38, status: "ok" } });
    expect(day1.status).toBe("suspect");

    const day2 = acceptPrice({ point: { date: "2026-11-11", close: 5, currency: "BRL" }, asset: stock, previous: { close: 60, status: "suspect" } });
    expect(day2.status).toBe("suspect");
  });
});
