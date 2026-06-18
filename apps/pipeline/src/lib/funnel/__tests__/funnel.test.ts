import { describe, expect, it } from "vitest";
import { deriveCacBands, resolveVerdict } from "../bands";
import { evaluateMetric } from "../health";
import { canTransition, LEAD_TRANSITIONS } from "../lead-status";
import { mapChannel } from "../map-channel";
import { EMPTY_COUNTS, type RawCounts } from "../types";

const counts = (overrides: Partial<RawCounts>): RawCounts => ({
  ...EMPTY_COUNTS,
  ...overrides,
});

const noLearning = { adsLaunchedAt: null, now: new Date("2026-06-12T12:00:00Z") };

describe("deriveCacBands — LTV/4 rule", () => {
  it("reproduces the R$99 / LTV R$590 example: 49 / 98 / 147 / 197", () => {
    const bands = deriveCacBands(59_000); // R$590 in cents
    expect(bands.map((b) => b.cacMaxCents)).toEqual([
      4_917, // ~R$49 → double down
      9_833, // ~R$98 → scale
      14_750, // R$147,50 (LTV/4) → optimize
      19_667, // ~R$197 → hold/fix
      null, // above → kill
    ]);
    expect(bands.map((b) => b.decision)).toEqual([
      "DOUBLE_DOWN",
      "SCALE",
      "OPTIMIZE",
      "HOLD_FIX",
      "KILL",
    ]);
  });
});

describe("resolveVerdict — 2D matrix (CAC × AR)", () => {
  // milhasgrupo's matrix from idea.yaml
  const bands = [
    { cacMaxCents: 10_000, arMin: 0.7, decision: "DOUBLE_DOWN" as const },
    { cacMaxCents: 20_000, arMin: 0.5, decision: "OPTIMIZE" as const },
    { cacMaxCents: 30_000, arMin: 0.3, decision: "HOLD_FIX" as const },
    { cacMaxCents: null, arMin: null, decision: "KILL" as const },
  ];

  it("cheap CAC + high AR → double down", () => {
    expect(resolveVerdict(8_000, 0.75, bands).decision).toBe("DOUBLE_DOWN");
  });

  it("cheap CAC but weak AR falls through to a worse band", () => {
    // CAC R$80 fits the first band, but AR 0.4 < 0.7 → falls to HOLD_FIX
    // (0.4 < 0.5 skips OPTIMIZE too)
    expect(resolveVerdict(8_000, 0.4, bands).decision).toBe("HOLD_FIX");
  });

  it("CAC over every ceiling → kill regardless of AR", () => {
    expect(resolveVerdict(45_000, 0.9, bands).decision).toBe("KILL");
  });

  it("no customers yet → collecting", () => {
    expect(resolveVerdict(null, null, bands).decision).toBe("COLLECTING");
  });

  it("AR unknown (no leads) ignores the AR dimension", () => {
    expect(resolveVerdict(8_000, null, bands).decision).toBe("DOUBLE_DOWN");
  });
});

describe("evaluateMetric — banding", () => {
  const thresholds = {
    CTR: { healthy: 0.015, death: 0.005 },
    BOUNCE_RATE: { healthy: 0.6, death: 0.8 },
  };

  it("CTR above healthy → healthy, no diagnosis", () => {
    const h = evaluateMetric(
      "CTR",
      counts({ impressions: 10_000, clicks: 200 }),
      thresholds,
      noLearning,
    );
    expect(h.value).toBeCloseTo(0.02);
    expect(h.status).toBe("healthy");
    expect(h.diagnosisKey).toBeNull();
  });

  it("CTR between death and healthy → warning with diagnosis", () => {
    const h = evaluateMetric(
      "CTR",
      counts({ impressions: 10_000, clicks: 100 }),
      thresholds,
      noLearning,
    );
    expect(h.status).toBe("warning");
    expect(h.diagnosisKey).toBe("ctr_low");
  });

  it("CTR at/below death → critical", () => {
    const h = evaluateMetric(
      "CTR",
      counts({ impressions: 10_000, clicks: 40 }),
      thresholds,
      noLearning,
    );
    expect(h.status).toBe("critical");
  });

  it("bounce is lowerIsBetter: 70% between 60 and 80 → warning", () => {
    const h = evaluateMetric(
      "BOUNCE_RATE",
      counts({ sessions: 500, engagedSessions: 150 }),
      thresholds,
      noLearning,
    );
    expect(h.value).toBeCloseTo(0.7);
    expect(h.status).toBe("warning");
    expect(h.diagnosisKey).toBe("bounce_high");
  });

  it("below MIN_SAMPLE → insufficient_data even with a terrible value", () => {
    const h = evaluateMetric(
      "CTR",
      counts({ impressions: 500, clicks: 1 }),
      thresholds,
      noLearning,
    );
    expect(h.status).toBe("insufficient_data");
    expect(h.sample).toEqual({ n: 500, required: 1000, basis: "impressions" });
  });

  it("no threshold defined (CPM) → neutral, value still computed", () => {
    const h = evaluateMetric(
      "CPM",
      counts({ impressions: 10_000, spendCents: 38_200 }),
      thresholds,
      noLearning,
    );
    expect(h.value).toBeCloseTo(3_820); // R$38,20 per mille
    expect(h.status).toBe("neutral");
  });
});

describe("evaluateMetric — learning phase (72h)", () => {
  it("forces ad-side metrics to insufficient_data with hours remaining", () => {
    const adsLaunchedAt = new Date("2026-06-11T12:00:00Z");
    const now = new Date("2026-06-12T12:00:00Z"); // 24h in → 48h remaining
    const h = evaluateMetric(
      "CTR",
      counts({ impressions: 50_000, clicks: 1_000 }),
      { CTR: { healthy: 0.015, death: 0.005 } },
      { adsLaunchedAt, now },
    );
    expect(h.status).toBe("insufficient_data");
    expect(h.diagnosisKey).toBe("learning_phase");
    expect(h.diagnosisParams?.hoursRemaining).toBe(48);
  });

  it("does not silence lead-side metrics", () => {
    const adsLaunchedAt = new Date("2026-06-11T12:00:00Z");
    const now = new Date("2026-06-12T12:00:00Z");
    const h = evaluateMetric(
      "AR",
      counts({ leads: 20, activated: 15 }),
      { AR: { healthy: 0.6, death: 0.3 } },
      { adsLaunchedAt, now },
    );
    expect(h.status).toBe("healthy");
  });
});

describe("evaluateMetric — CAC zero-customer exception", () => {
  it("0 customers normally → insufficient_data", () => {
    const h = evaluateMetric(
      "CAC",
      counts({ spendCents: 30_000 }),
      {},
      { ...noLearning, killCacCents: 40_000 },
    );
    expect(h.status).toBe("insufficient_data");
  });

  it("0 customers with spend past the kill line → critical", () => {
    const h = evaluateMetric(
      "CAC",
      counts({ spendCents: 50_000 }),
      {},
      { ...noLearning, killCacCents: 40_000 },
    );
    expect(h.status).toBe("critical");
    expect(h.diagnosisKey).toBe("cac_zero_customers_over_kill");
    expect(h.diagnosisParams).toEqual({ spend: 500, killCac: 400 });
  });
});

describe("mapChannel", () => {
  it("gclid wins even without UTMs", () => {
    expect(mapChannel({ gclid: "abc123" })).toBe("GOOGLE");
  });
  it("meta sources", () => {
    expect(mapChannel({ source: "meta", medium: "paid" })).toBe("META");
    expect(mapChannel({ source: "instagram" })).toBe("META");
  });
  it("google paid vs organic", () => {
    expect(mapChannel({ source: "google", medium: "cpc" })).toBe("GOOGLE");
    expect(mapChannel({ source: "google", medium: "organic" })).toBe("ORGANIC");
  });
  it("GA4 placeholders → direct", () => {
    expect(mapChannel({ source: "(direct)", medium: "(none)" })).toBe("DIRECT");
  });
  it("empty with referrer → organic; empty without → direct", () => {
    expect(mapChannel({ referrer: "https://blog.example.com" })).toBe("ORGANIC");
    expect(mapChannel({})).toBe("DIRECT");
  });
});

describe("lead status state machine", () => {
  it("follows the playbook's happy path", () => {
    expect(canTransition("NEW", "ONBOARDING")).toBe(true);
    expect(canTransition("ONBOARDING", "QUALIFIED")).toBe(true);
    expect(canTransition("QUALIFIED", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "CUSTOMER")).toBe(true);
  });
  it("blocks skipping QUALIFIED on the way to ACTIVE", () => {
    expect(canTransition("ONBOARDING", "ACTIVE")).toBe(false);
    expect(canTransition("NEW", "CUSTOMER")).toBe(false);
  });
  it("COLD re-engages without restarting", () => {
    expect(LEAD_TRANSITIONS.COLD).toContain("QUALIFIED");
  });
  it("LOST is terminal", () => {
    expect(LEAD_TRANSITIONS.LOST).toEqual([]);
  });
});
