import type { Job, Company, SearchProfile } from "../../generated/prisma";

// The ~20 structured features the learned triage model trains on. Every
// feature is a plain number so a logistic-regression coefficient vector can
// multiply straight through it — string/categorical signals (stack overlap,
// tristate fields, sector match) are pre-reduced to a score here rather
// than one-hot encoded, which keeps the model small enough to explain in a
// sentence per coefficient on /lab.
export const FEATURE_KEYS = [
  "coreStackOverlap",
  "desiredStackOverlap",
  "avoidStackOverlap",
  "seniorityVsMin",
  "salaryVsFloor",
  "salaryVsTarget",
  "salaryUndeclared",
  "equitySignal",
  "hiresBrazilSignal",
  "companyPriority",
  "companyHealthSignal",
  "companyIsFavorite",
  "sectorMatch",
  "buildVsOperateSignal",
  "peopleManagement",
  "isYc",
  "isCoreInfra",
  "sourceIsAts",
  "titleMatchesTarget",
  "bias",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureVector = Record<FeatureKey, number>;

const SENIORITY_RANK: Record<string, number> = {
  UNKNOWN: 0,
  JUNIOR: 1,
  MID: 2,
  SENIOR: 3,
  STAFF: 4,
  SENIOR_STAFF: 4.5,
  PRINCIPAL: 5,
};

const TRISTATE_SIGNAL: Record<string, number> = {
  SIM: 1,
  PROVAVEL_SIM: 0.5,
  A_CONFIRMAR: 0,
  PROVAVEL_NAO: -0.5,
  NAO: -1,
};

const HEALTH_SIGNAL: Record<string, number> = {
  FORTE: 1,
  ATENCAO: 0,
  A_CONFIRMAR: 0,
  RISCO: -1,
};

const BUILD_VS_OPERATE_SIGNAL: Record<string, number> = {
  CONSTROI: 1,
  MEIO_TERMO: 0,
  INDETERMINADO: 0,
  OPERA: -1,
};

function overlapRatio(jobStack: string[], profileStack: string[]): number {
  if (profileStack.length === 0 || jobStack.length === 0) return 0;
  const jobLower = new Set(jobStack.map((s) => s.toLowerCase()));
  const hits = profileStack.filter((s) => jobLower.has(s.toLowerCase())).length;
  return hits / profileStack.length;
}

/**
 * Builds the feature vector for one (Job, Company, SearchProfile) triple.
 * Called both when a TriageDecision is recorded (the label a training run
 * consumes) and when scoring a job for display — same function, so the
 * coefficients on /lab always describe the same inputs a decision reflects.
 */
export function buildFeatureVector(job: Job, company: Company, profile: SearchProfile): FeatureVector {
  const salaryDeclared = job.salaryMax !== null;
  return {
    coreStackOverlap: overlapRatio(job.stack, profile.coreStack),
    desiredStackOverlap: overlapRatio(job.stack, profile.desiredStack),
    avoidStackOverlap: overlapRatio(job.stack, profile.avoidStack),
    seniorityVsMin: (SENIORITY_RANK[job.seniority] ?? 0) - (SENIORITY_RANK[profile.minSeniority] ?? 0),
    salaryVsFloor: salaryDeclared ? (job.salaryMax! - profile.salaryFloorUsdAnnual) / profile.salaryFloorUsdAnnual : 0,
    salaryVsTarget: salaryDeclared ? (job.salaryMax! - profile.salaryTargetUsdAnnual) / profile.salaryTargetUsdAnnual : 0,
    salaryUndeclared: salaryDeclared ? 0 : 1,
    equitySignal: TRISTATE_SIGNAL[job.equity] ?? 0,
    hiresBrazilSignal: TRISTATE_SIGNAL[job.hiresBrazil] ?? 0,
    companyPriority: company.priority ? (5 - company.priority) / 4 : 0,
    companyHealthSignal: HEALTH_SIGNAL[company.health] ?? 0,
    companyIsFavorite: company.isFavorite ? 1 : 0,
    sectorMatch: profile.preferredSectors.some((s) => (job.sector ?? "").toLowerCase().includes(s.toLowerCase())) ? 1 : 0,
    buildVsOperateSignal: BUILD_VS_OPERATE_SIGNAL[job.buildVsOperate] ?? 0,
    peopleManagement: job.peopleManagement ? 1 : 0,
    isYc: /\bYC\b|Y Combinator/i.test(company.name) || (company.stage ?? "").toLowerCase().includes("yc") ? 1 : 0,
    isCoreInfra: profile.bonusCoreInfra && /infra|dev tools|platform|database|banco/i.test(job.sector ?? "") ? 1 : 0,
    sourceIsAts: 1, // placeholder until JobSighting.sourceKey is joined in by the caller
    titleMatchesTarget: profile.targetTitles.some((t) => job.title.toLowerCase().includes(t.toLowerCase())) ? 1 : 0,
    bias: 1,
  };
}

export function featureVectorToArray(v: FeatureVector): number[] {
  return FEATURE_KEYS.map((k) => v[k]);
}
