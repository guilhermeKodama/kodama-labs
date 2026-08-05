import type { MetricKeyT, MetricStatus } from "./types";

// Metric × status → diagnosis message key (texts live in messages/*.json
// under "diagnosis.", straight from the user's metrics dictionary). Healthy
// metrics get no diagnosis — the dashboard doesn't nag when things work.
const DIAGNOSIS: Partial<Record<MetricKeyT, Partial<Record<MetricStatus, string>>>> = {
  CPM: {
    warning: "cpm_high",
    critical: "cpm_high",
  },
  CTR: {
    warning: "ctr_low",
    critical: "ctr_low",
  },
  BOUNCE_RATE: {
    warning: "bounce_high",
    critical: "bounce_high",
  },
  SESSION_TO_LEAD: {
    warning: "session_to_lead_low",
    critical: "session_to_lead_low",
  },
  CPL: {
    warning: "cpl_high",
    critical: "cpl_high",
  },
  AR: {
    warning: "ar_low",
    critical: "ar_low",
  },
  PCR: {
    warning: "pcr_mid",
    critical: "pcr_low",
  },
  CAC: {
    warning: "cac_high",
    critical: "cac_over_kill",
  },
};

export function diagnosisKeyFor(
  key: MetricKeyT,
  status: MetricStatus,
): string | null {
  return DIAGNOSIS[key]?.[status] ?? null;
}
