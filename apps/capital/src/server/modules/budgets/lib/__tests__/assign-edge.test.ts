import { describe, expect, it } from "vitest";
import { stillToCome, typical } from "../assign";

describe("stillToCome with series of different lengths", () => {
  it("treats a month with no recorded tail as having none, and a missing total as nothing spent", () => {
    // Two totals but one tail: the second month's early spend is its whole total, and the typical tail is the one tail.
    expect(stillToCome([100, 50], [10], 0)).toBe(10);
    // More tails than totals: the typical tail is the smaller of the two, and the month has one total.
    expect(stillToCome([100], [60, 70], 0)).toBe(60);
    expect(stillToCome([], [60, 70], 0)).toBe(0);
  });

  it("recognizes only what the month has already spent, up to the early ceiling", () => {
    const totals = [200, 100, 100];
    const tails = [50, 50, 50];
    expect(stillToCome(totals, tails, 0)).toBe(50);
    expect(stillToCome(totals, tails, -30)).toBe(50); // spend below zero is not recognized
    expect(stillToCome(totals, tails, 80)).toBe(20); // a typical month of 100, 80 of it already spent
    expect(stillToCome(totals, tails, 500)).toBe(0); // recognized stops at the early ceiling (150)
  });
});

describe("typical", () => {
  it("averages the two central values of an even count and ignores order", () => {
    expect(typical([40, 10, 30, 20])).toBe(25);
    expect(typical([5, 1, 3])).toBe(3);
  });
});
