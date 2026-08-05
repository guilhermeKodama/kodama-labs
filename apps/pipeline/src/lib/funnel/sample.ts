import type { MetricKeyT, RawCounts } from "./types";

// Below these sample sizes a metric is statistically noise — status becomes
// insufficient_data and the UI greys the chip (value still shown).
export const MIN_SAMPLE: Record<MetricKeyT, { basis: keyof RawCounts; n: number }> = {
  CPM: { basis: "impressions", n: 1000 },
  CTR: { basis: "impressions", n: 1000 },
  CPC: { basis: "clicks", n: 100 },
  BOUNCE_RATE: { basis: "sessions", n: 100 },
  SESSION_TO_LEAD: { basis: "sessions", n: 100 },
  CPL: { basis: "clicks", n: 100 }, // user rule: < 100 clicks → CPL not significant
  AR: { basis: "leads", n: 10 },
  PCR: { basis: "activated", n: 5 },
  CAC: { basis: "customers", n: 1 }, // zero-customer exception lives in health.ts
};

// golden-rules.md + both ads playbooks: "read data only after 72h" — the
// algorithm's learning phase makes early CPM/CTR/CPC meaningless.
export const LEARNING_PHASE_MS = 72 * 3_600_000;
export const LEARNING_PHASE_METRICS: ReadonlySet<MetricKeyT> = new Set([
  "CPM",
  "CTR",
  "CPC",
]);

export function inLearningPhase(
  adsLaunchedAt: Date | null | undefined,
  now: Date,
): { active: boolean; hoursRemaining: number } {
  if (!adsLaunchedAt) return { active: false, hoursRemaining: 0 };
  const elapsed = now.getTime() - adsLaunchedAt.getTime();
  if (elapsed >= LEARNING_PHASE_MS || elapsed < 0) {
    return { active: false, hoursRemaining: 0 };
  }
  return {
    active: true,
    hoursRemaining: Math.ceil((LEARNING_PHASE_MS - elapsed) / 3_600_000),
  };
}
