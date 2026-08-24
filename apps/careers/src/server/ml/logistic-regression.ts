// A small, dependency-free logistic regression: gradient descent with L2
// regularization. The feature count here (~20) and example count (low
// hundreds at most) don't remotely justify pulling in a full ML library —
// this is maybe 60 lines and every step of it is inspectable, which matters
// more than raw speed for a model whose whole point is to be explainable.

export type TrainedModel = { weights: number[]; bias: number };

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

export function trainLogisticRegression(
  X: number[][],
  y: number[],
  opts: { epochs?: number; learningRate?: number; l2?: number } = {}
): TrainedModel {
  const epochs = opts.epochs ?? 500;
  const lr = opts.learningRate ?? 0.1;
  const l2 = opts.l2 ?? 0.01;
  const n = X.length;
  const dims = X[0]?.length ?? 0;

  const weights: number[] = new Array(dims).fill(0);
  let bias = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(dims).fill(0);
    let gradB = 0;

    for (let i = 0; i < n; i++) {
      const pred = sigmoid(dot(weights, X[i]!) + bias);
      const error = pred - y[i]!;
      for (let d = 0; d < dims; d++) gradW[d] += error * X[i]![d]!;
      gradB += error;
    }

    for (let d = 0; d < dims; d++) {
      weights[d] -= lr * (gradW[d] / n + l2 * weights[d]);
    }
    bias -= lr * (gradB / n);
  }

  return { weights, bias };
}

export function predictProba(model: TrainedModel, x: number[]): number {
  return sigmoid(dot(model.weights, x) + model.bias);
}

export type CvMetrics = {
  precision: number; // precision on the DESCARTAR class (what matters for auto-discard safety)
  recall: number;
  auc: number;
  bestThreshold: number;
};

/**
 * k-fold cross-validation, sweeping candidate thresholds to find the one
 * where precision on "would discard" clears the bar the caller passes in
 * (0.95 for auto-triage eligibility, per the product rule: at most 1 in 20
 * auto-discards may be something the user would have kept).
 */
export function crossValidate(X: number[][], y: number[], k = 5, minPrecision = 0.95): CvMetrics {
  const n = X.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  // Deterministic shuffle (no Math.random — reproducible across runs).
  for (let i = indices.length - 1; i > 0; i--) {
    const j = (i * 2654435761) % (i + 1);
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }

  const foldSize = Math.ceil(n / k);
  const allPreds: { proba: number; actual: number }[] = [];

  for (let fold = 0; fold < k; fold++) {
    const testIdx = new Set(indices.slice(fold * foldSize, (fold + 1) * foldSize));
    const trainX: number[][] = [];
    const trainY: number[] = [];
    const testX: number[][] = [];
    const testY: number[] = [];

    for (let i = 0; i < n; i++) {
      if (testIdx.has(i)) {
        testX.push(X[i]!);
        testY.push(y[i]!);
      } else {
        trainX.push(X[i]!);
        trainY.push(y[i]!);
      }
    }
    if (trainX.length === 0 || testX.length === 0) continue;

    const model = trainLogisticRegression(trainX, trainY);
    for (let i = 0; i < testX.length; i++) {
      allPreds.push({ proba: predictProba(model, testX[i]!), actual: testY[i]! });
    }
  }

  // y=1 means "shortlist"; auto-triage acts on the DISCARD side, so sweep
  // thresholds on (1 - proba) and find the lowest proba cutoff where
  // everything below it was actually discarded (actual=0) at >= minPrecision.
  let bestThreshold = 0;
  let bestPrecision = 0;
  let bestRecall = 0;

  // Capped well below 0.5: with a small, discard-skewed label set (this
  // product's actual data — most triage decisions are "no"), precision
  // alone stays deceptively high even at a loose threshold, because
  // "discard" is already the majority class. A threshold near 0.5 reads as
  // "more likely than not to be discard", not the "confident" zone this
  // layer is supposed to require before acting without a human. Capping
  // the sweep keeps the selected threshold in a genuinely low-probability
  // band regardless of how skewed the training labels are.
  const MAX_THRESHOLD = 0.15;
  for (let t = 0.05; t <= MAX_THRESHOLD; t += 0.01) {
    const belowThreshold = allPreds.filter((p) => p.proba < t);
    if (belowThreshold.length < 5) continue; // too few samples to trust the estimate
    const truePositives = belowThreshold.filter((p) => p.actual === 0).length;
    const precision = truePositives / belowThreshold.length;
    const totalActualDiscards = allPreds.filter((p) => p.actual === 0).length;
    const recall = totalActualDiscards > 0 ? truePositives / totalActualDiscards : 0;

    if (precision >= minPrecision && recall > bestRecall) {
      bestThreshold = t;
      bestPrecision = precision;
      bestRecall = recall;
    }
  }

  const auc = computeAuc(allPreds);

  return { precision: bestPrecision, recall: bestRecall, auc, bestThreshold };
}

function computeAuc(preds: { proba: number; actual: number }[]): number {
  const positives = preds.filter((p) => p.actual === 1);
  const negatives = preds.filter((p) => p.actual === 0);
  if (positives.length === 0 || negatives.length === 0) return 0.5;
  let concordant = 0;
  let total = 0;
  for (const pos of positives) {
    for (const neg of negatives) {
      total++;
      if (pos.proba > neg.proba) concordant++;
      else if (pos.proba === neg.proba) concordant += 0.5;
    }
  }
  return total > 0 ? concordant / total : 0.5;
}
