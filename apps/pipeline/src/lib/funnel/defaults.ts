import type { ThresholdMap } from "./types";

// Code defaults from the metrics dictionary / one-pager template, used when
// an idea's config omits a metric. CPM intentionally has no default — the
// dictionary defines its meaning but no number, so it renders neutral.
export const DEFAULT_THRESHOLDS: ThresholdMap = {
  CTR: { healthy: 0.015, death: 0.005 },
  BOUNCE_RATE: { healthy: 0.6, death: 0.8 },
  SESSION_TO_LEAD: { healthy: 0.05, death: 0.01 },
  AR: { healthy: 0.6, death: 0.3 },
  PCR: { healthy: 0.3, death: 0.1 },
};

export const DEFAULT_GOOGLE_CTR = { healthy: 0.03, death: 0.01 };
