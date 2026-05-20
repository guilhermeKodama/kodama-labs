import { describe, it, expect, vi } from "vitest";

// analyze-overpricing imports prisma at module load — stub it so the pure
// helper under test can be imported without a database.
vi.mock("@sentinel/server/lib/prisma", () => ({
  prisma: {},
}));
vi.mock("@sentinel/server/lib/job-runner", () => ({
  runJob: vi.fn(),
}));
vi.mock("@sentinel/server/lib/alert-i18n", () => ({
  buildAlertI18n: vi.fn(),
  renderCodePtBr: vi.fn(),
  renderPtBr: vi.fn(),
}));

import { evaluateContextualAlert } from "../analyze-overpricing";

describe("evaluateContextualAlert", () => {
  it("skips when unit price is within the estimated range", () => {
    // Regression: Braille signs case — unitPrice R$35 fell within estimate
    // R$35–R$55, but the old code compared totalPrice R$38,361.75 to expected
    // R$45 and produced an 85148% deviation. Must not alert.
    const result = evaluateContextualAlert(35, {
      minPrice: 35,
      maxPrice: 55,
      expectedPrice: 45,
    });
    expect(result.skip).toBe(true);
    if (result.skip) {
      expect(result.reason).toBe("unit_price_within_or_near_range");
    }
  });

  it("skips when unit price is just above max but within 30% of expected", () => {
    // unitPrice=58, max=55, expected=45 → deviation 28.9% → still skip (LOW band).
    const result = evaluateContextualAlert(58, {
      minPrice: 35,
      maxPrice: 55,
      expectedPrice: 45,
    });
    expect(result.skip).toBe(true);
  });

  it("fires when unit price is materially above the estimated range", () => {
    // unitPrice=80, max=55, expected=45 → deviation 77.8% → HIGH band, fire.
    const result = evaluateContextualAlert(80, {
      minPrice: 35,
      maxPrice: 55,
      expectedPrice: 45,
    });
    expect(result.skip).toBe(false);
    if (!result.skip) {
      expect(result.deviation).toBeGreaterThan(70);
      expect(result.deviation).toBeLessThan(80);
    }
  });

  it("skips safely when expectedPrice is zero (no divide by zero)", () => {
    // Degenerate input — deviation defaults to 0, and 0 <= 30 → skip.
    const result = evaluateContextualAlert(100, {
      minPrice: 0,
      maxPrice: 0,
      expectedPrice: 0,
    });
    expect(result.skip).toBe(true);
    expect(result.deviation).toBe(0);
  });

  it("computes correct deviation when alert fires", () => {
    // unitPrice=200, expected=100 → 100% deviation
    const result = evaluateContextualAlert(200, {
      minPrice: 80,
      maxPrice: 120,
      expectedPrice: 100,
    });
    expect(result.skip).toBe(false);
    if (!result.skip) {
      expect(result.deviation).toBeCloseTo(100, 1);
    }
  });
});
