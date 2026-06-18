import {
  DIRECTION,
  METRIC_UNIT,
  type MetricHealth,
  type MetricKeyT,
  type MetricStatus,
  type RawCounts,
  type ThresholdMap,
} from "./types";
import {
  inLearningPhase,
  LEARNING_PHASE_METRICS,
  MIN_SAMPLE,
} from "./sample";
import { diagnosisKeyFor } from "./diagnosis";

// Derived metrics are computed AFTER summation — never stored, never averaged
// across days. Money in cents; ratios as fractions.
export const FORMULAS: Record<MetricKeyT, (c: RawCounts) => number | null> = {
  CPM: (c) => (c.impressions ? (c.spendCents / c.impressions) * 1000 : null),
  CTR: (c) => (c.impressions ? c.clicks / c.impressions : null),
  CPC: (c) => (c.clicks ? c.spendCents / c.clicks : null),
  BOUNCE_RATE: (c) => (c.sessions ? 1 - c.engagedSessions / c.sessions : null),
  SESSION_TO_LEAD: (c) => (c.sessions ? c.leads / c.sessions : null),
  CPL: (c) => (c.leads ? c.spendCents / c.leads : null),
  AR: (c) => (c.leads ? c.activated / c.leads : null),
  PCR: (c) => (c.activated ? c.customers / c.activated : null),
  CAC: (c) => (c.customers ? c.spendCents / c.customers : null),
};

function band(
  key: MetricKeyT,
  value: number,
  threshold: { healthy: number; death: number },
): MetricStatus {
  if (DIRECTION[key] === "lowerIsBetter") {
    if (value <= threshold.healthy) return "healthy";
    if (value >= threshold.death) return "critical";
    return "warning";
  }
  if (value >= threshold.healthy) return "healthy";
  if (value <= threshold.death) return "critical";
  return "warning";
}

export interface EvaluateContext {
  adsLaunchedAt: Date | null;
  now: Date;
  // CAC extras: zero-customer exception + kill line for the diagnosis text
  killCacCents?: number | null;
}

export function evaluateMetric(
  key: MetricKeyT,
  counts: RawCounts,
  thresholds: ThresholdMap,
  ctx: EvaluateContext,
): MetricHealth {
  const value = FORMULAS[key](counts);
  const sampleSpec = MIN_SAMPLE[key];
  const sampleN = counts[sampleSpec.basis];
  const threshold = thresholds[key] ?? null;
  const base: Omit<MetricHealth, "status" | "diagnosisKey"> = {
    key,
    value,
    unit: METRIC_UNIT[key],
    sample: { n: sampleN, required: sampleSpec.n, basis: sampleSpec.basis },
    threshold,
  };

  // 72h learning phase silences the ad-side metrics entirely.
  const learning = inLearningPhase(ctx.adsLaunchedAt, ctx.now);
  if (learning.active && LEARNING_PHASE_METRICS.has(key)) {
    return {
      ...base,
      status: "insufficient_data",
      diagnosisKey: "learning_phase",
      diagnosisParams: { hoursRemaining: learning.hoursRemaining },
    };
  }

  // CAC zero-customer exception: 0 customers normally means "still collecting",
  // EXCEPT when spend already blew past the kill line — then the effective CAC
  // is provably over it and the idea must not sit grey while burning budget.
  if (key === "CAC" && counts.customers === 0) {
    if (ctx.killCacCents != null && counts.spendCents > ctx.killCacCents) {
      return {
        ...base,
        status: "critical",
        diagnosisKey: "cac_zero_customers_over_kill",
        diagnosisParams: {
          spend: Math.round(counts.spendCents / 100),
          killCac: Math.round(ctx.killCacCents / 100),
        },
      };
    }
    return { ...base, status: "insufficient_data", diagnosisKey: "insufficient" };
  }

  if (sampleN < sampleSpec.n) {
    return { ...base, status: "insufficient_data", diagnosisKey: "insufficient" };
  }

  if (value == null) {
    return { ...base, status: "insufficient_data", diagnosisKey: "insufficient" };
  }

  if (!threshold) {
    // No target defined (e.g. CPM) — show the value, never color it.
    return { ...base, status: "neutral", diagnosisKey: null };
  }

  const status = band(key, value, threshold);
  return { ...base, status, diagnosisKey: diagnosisKeyFor(key, status) };
}

export function evaluateFunnel(
  counts: RawCounts,
  thresholds: ThresholdMap,
  ctx: EvaluateContext,
): MetricHealth[] {
  const keys: MetricKeyT[] = [
    "CPM",
    "CTR",
    "BOUNCE_RATE",
    "SESSION_TO_LEAD",
    "CPL",
    "AR",
    "PCR",
    "CAC",
  ];
  return keys.map((key) => evaluateMetric(key, counts, thresholds, ctx));
}
