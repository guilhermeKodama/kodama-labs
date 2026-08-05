// Pure domain types for the funnel health engine. No Prisma, no env — this
// module is imported by server rollups AND client components so the funnel
// chips and the API color metrics with exactly the same logic.

export const METRIC_KEYS = [
  "CPM",
  "CPC",
  "CTR",
  "BOUNCE_RATE",
  "SESSION_TO_LEAD",
  "CPL",
  "AR",
  "PCR",
  "CAC",
] as const;

export type MetricKeyT = (typeof METRIC_KEYS)[number];

export interface RawCounts {
  spendCents: number;
  impressions: number;
  clicks: number;
  sessions: number;
  engagedSessions: number;
  leads: number;
  activated: number;
  customers: number;
}

export const EMPTY_COUNTS: RawCounts = {
  spendCents: 0,
  impressions: 0,
  clicks: 0,
  sessions: 0,
  engagedSessions: 0,
  leads: 0,
  activated: 0,
  customers: 0,
};

export function addCounts(a: RawCounts, b: Partial<RawCounts>): RawCounts {
  return {
    spendCents: a.spendCents + (b.spendCents ?? 0),
    impressions: a.impressions + (b.impressions ?? 0),
    clicks: a.clicks + (b.clicks ?? 0),
    sessions: a.sessions + (b.sessions ?? 0),
    engagedSessions: a.engagedSessions + (b.engagedSessions ?? 0),
    leads: a.leads + (b.leads ?? 0),
    activated: a.activated + (b.activated ?? 0),
    customers: a.customers + (b.customers ?? 0),
  };
}

export type MetricStatus =
  | "healthy"
  | "warning"
  | "critical"
  | "insufficient_data"
  | "neutral"; // no threshold defined (e.g. CPM without a target) — value shown, never colored

export interface MetricHealth {
  key: MetricKeyT;
  value: number | null; // null when the denominator is 0
  unit: "cents" | "ratio";
  status: MetricStatus;
  diagnosisKey: string | null; // next-intl message id under "diagnosis."
  diagnosisParams?: Record<string, string | number>;
  sample: { n: number; required: number; basis: keyof RawCounts };
  threshold: { healthy: number; death: number } | null;
}

export const DIRECTION: Record<MetricKeyT, "lowerIsBetter" | "higherIsBetter"> = {
  CPM: "lowerIsBetter",
  CPC: "lowerIsBetter",
  CPL: "lowerIsBetter",
  CAC: "lowerIsBetter",
  BOUNCE_RATE: "lowerIsBetter",
  CTR: "higherIsBetter",
  SESSION_TO_LEAD: "higherIsBetter",
  AR: "higherIsBetter",
  PCR: "higherIsBetter",
};

export const METRIC_UNIT: Record<MetricKeyT, "cents" | "ratio"> = {
  CPM: "cents",
  CPC: "cents",
  CPL: "cents",
  CAC: "cents",
  BOUNCE_RATE: "ratio",
  CTR: "ratio",
  SESSION_TO_LEAD: "ratio",
  AR: "ratio",
  PCR: "ratio",
};

export type ThresholdMap = Partial<
  Record<MetricKeyT, { healthy: number; death: number }>
>;

export type CacDecision = "DOUBLE_DOWN" | "SCALE" | "OPTIMIZE" | "HOLD_FIX" | "KILL";

export interface CacBand {
  cacMaxCents: number | null; // null = open-ended (the kill band)
  arMin: number | null;
  decision: CacDecision;
}

export type VerdictDecision = CacDecision | "COLLECTING";

export interface Verdict {
  decision: VerdictDecision;
  status: MetricStatus;
}
