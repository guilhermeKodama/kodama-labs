import { prisma } from "../lib/prisma";
import { getActiveProfile } from "../modules/search-profile";
import { buildFeatureVector, featureVectorToArray, FEATURE_KEYS, type FeatureVector } from "./features";
import { trainLogisticRegression, crossValidate } from "./logistic-regression";

const MIN_TRAINING_DECISIONS = 10;
const MIN_PRECISION_FOR_AUTO_TRIAGE = 0.95;
// A correction (the user reversing an auto-discard) is exactly the case the
// model got wrong — it's weighted 3x in training by being included as 3
// duplicate rows rather than a fractional sample weight, which every
// standard SGD/logreg loop already knows how to consume with no extra code.
const CORRECTION_WEIGHT = 3;

export type TrainResult =
  | { trained: false; reason: string }
  | {
      trained: true;
      version: number;
      precision: number;
      recall: number;
      auc: number;
      trainedOnCount: number;
      autoTriageEligible: boolean;
    };

/**
 * Trains a new ScoringModel from every TriageDecision recorded so far.
 * Always starts in shadow mode — see prisma/schema.prisma's comment on
 * ScoringModel.shadowMode. The threshold is DERIVED from cross-validated
 * precision, never picked by hand: if no cut-point clears 95% precision on
 * the discard side, autoTriageEligible comes back false and nothing in the
 * app is allowed to flip shadowMode off.
 */
export async function trainScoringModel(): Promise<TrainResult> {
  const decisions = await prisma.triageDecision.findMany({
    include: { job: { include: { company: true } } },
    orderBy: { decidedAt: "asc" },
  });

  if (decisions.length < MIN_TRAINING_DECISIONS) {
    return {
      trained: false,
      reason: `Só ${decisions.length} decisões registradas — mínimo de ${MIN_TRAINING_DECISIONS} para treinar.`,
    };
  }

  const profile = await getActiveProfile();

  const X: number[][] = [];
  const y: number[] = [];

  for (const decision of decisions) {
    if (!decision.job) continue;
    const vector: FeatureVector =
      (decision.featuresSnapshot as unknown as FeatureVector | null) ??
      buildFeatureVector(decision.job, decision.job.company, profile);
    const arr = featureVectorToArray(vector);
    const label = decision.label === "SHORTLIST" ? 1 : 0;
    const repeats = decision.wasCorrection ? CORRECTION_WEIGHT : 1;
    for (let i = 0; i < repeats; i++) {
      X.push(arr);
      y.push(label);
    }
  }

  if (X.length < MIN_TRAINING_DECISIONS) {
    return { trained: false, reason: "Amostras insuficientes após aplicar pesos de correção." };
  }

  const cv = crossValidate(X, y, 5, MIN_PRECISION_FOR_AUTO_TRIAGE);
  const finalModel = trainLogisticRegression(X, y);

  const lastVersion = await prisma.scoringModel.findFirst({ orderBy: { version: "desc" } });
  const version = (lastVersion?.version ?? 0) + 1;

  const coefficients: Record<string, number> = {};
  FEATURE_KEYS.forEach((key, i) => {
    coefficients[key] = finalModel.weights[i]!;
  });

  const autoTriageEligible = cv.precision >= MIN_PRECISION_FOR_AUTO_TRIAGE && cv.bestThreshold > 0;

  await prisma.scoringModel.create({
    data: {
      version,
      coefficients,
      intercept: finalModel.bias,
      threshold: cv.bestThreshold,
      precision: cv.precision,
      recall: cv.recall,
      auc: cv.auc,
      trainedOnCount: X.length,
      shadowMode: true, // always — activation is a separate, explicit user action
    },
  });

  return {
    trained: true,
    version,
    precision: cv.precision,
    recall: cv.recall,
    auc: cv.auc,
    trainedOnCount: X.length,
    autoTriageEligible,
  };
}
