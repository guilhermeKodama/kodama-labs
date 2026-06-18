// Canonical lead lifecycle, generalized from ideas/milhasgrupo/lead-playbook.md
// ("(vazio) → Lead → Onboarding → Qualified → Active → Issued; ↘ Cold ↘ Lost").
// Pure module — imported by the transition service AND the UI so both enforce
// the same map.

export const LEAD_STATUSES = [
  "NEW",
  "ONBOARDING",
  "QUALIFIED",
  "ACTIVE",
  "CUSTOMER",
  "COLD",
  "LOST",
] as const;

export type LeadStatusValue = (typeof LEAD_STATUSES)[number];

export const LEAD_TRANSITIONS: Record<LeadStatusValue, LeadStatusValue[]> = {
  NEW: ["ONBOARDING", "LOST"],
  ONBOARDING: ["QUALIFIED", "COLD", "LOST"],
  QUALIFIED: ["ACTIVE", "COLD", "LOST"],
  ACTIVE: ["CUSTOMER", "COLD", "LOST"],
  COLD: ["ONBOARDING", "QUALIFIED", "LOST"], // re-engagement resumes where it left off
  CUSTOMER: ["LOST"], // churn, post-validation
  LOST: [], // terminal
};

export function canTransition(
  from: LeadStatusValue,
  to: LeadStatusValue,
): boolean {
  return LEAD_TRANSITIONS[from]?.includes(to) ?? false;
}

// Column on Lead that records the FIRST time a status was ever reached.
export const FIRST_REACH_COLUMN: Partial<Record<LeadStatusValue, string>> = {
  ONBOARDING: "onboardingAt",
  QUALIFIED: "qualifiedAt",
  ACTIVE: "activatedAt",
  CUSTOMER: "convertedAt",
  COLD: "coldAt",
  LOST: "lostAt",
};
