export interface RiskSignals {
  hasOverpricedItems: boolean;
  overpricingDeviation: number;
  isShellCompany: boolean;
  hasSanctions: boolean;
  hasNetworkAlerts: boolean;
  aiRiskScore: number | null;
}

const WEIGHTS = {
  overpricing: 0.25,
  shellCompany: 0.20,
  sanctions: 0.30,
  network: 0.15,
  ai: 0.10,
};

export function computeCompositeRiskScore(signals: RiskSignals): number {
  let score = 0;

  if (signals.hasOverpricedItems) {
    const overpricingScore = Math.min(1, signals.overpricingDeviation / 200);
    score += WEIGHTS.overpricing * overpricingScore;
  }

  if (signals.isShellCompany) {
    score += WEIGHTS.shellCompany;
  }

  if (signals.hasSanctions) {
    score += WEIGHTS.sanctions;
  }

  if (signals.hasNetworkAlerts) {
    score += WEIGHTS.network;
  }

  if (signals.aiRiskScore != null) {
    score += WEIGHTS.ai * signals.aiRiskScore;
  }

  return Math.min(1, Math.max(0, score));
}
