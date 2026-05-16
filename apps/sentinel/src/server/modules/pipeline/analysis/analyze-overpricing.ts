import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { Prisma } from "@/generated/prisma";
import {
  buildAlertI18n,
  renderCodePtBr,
  renderPtBr,
  type AlertI18nParam,
} from "@sentinel/server/lib/alert-i18n";
import { classifyItem, type ItemKind } from "./classify-item";
import {
  evaluateOverpricing,
  type EvaluateInput,
  type EvaluateVerdict,
  type PriceAnalysisSummary,
} from "./evaluate-overpricing";

const BATCH_SIZE = 300;
const EVAL_BATCH_SIZE = 100;
const IQR_DEVIATION_THRESHOLD = 0.3;
const BID_SPREAD_THRESHOLD = 2.0;
const DESC_MIN_GROUP_SIZE = 5;

// ---------------------------------------------------------------------------
// Context extraction — used by statistical strategies to qualify comparisons
// ---------------------------------------------------------------------------

const VEHICLE_BRANDS: Record<string, string[]> = {
  FIAT: ["UNO", "PALIO", "SIENA", "STRADA", "TORO", "MOBI", "ARGO", "CRONOS", "FIORINO", "DUCATO", "DOBLO", "PULSE", "FASTBACK", "PUNTO", "LINEA", "BRAVO"],
  VW: ["GOL", "VOYAGE", "SAVEIRO", "AMAROK", "POLO", "VIRTUS", "NIVUS", "TAOS", "TIGUAN", "JETTA", "PASSAT", "FOX", "CROSSFOX", "SPACEFOX", "KOMBI", "FUSCA"],
  VOLKSWAGEN: ["GOL", "VOYAGE", "SAVEIRO", "AMAROK", "POLO", "VIRTUS", "NIVUS", "TAOS", "TIGUAN", "JETTA", "PASSAT", "FOX", "CROSSFOX", "SPACEFOX"],
  CHEVROLET: ["ONIX", "PRISMA", "COBALT", "CRUZE", "SPIN", "TRACKER", "TRAILBLAZER", "S10", "MONTANA", "CLASSIC", "CELTA", "CORSA", "ASTRA", "VECTRA", "MERIVA", "ZAFIRA"],
  GM: ["ONIX", "PRISMA", "COBALT", "CRUZE", "SPIN", "TRACKER", "S10", "MONTANA", "CLASSIC", "CELTA", "CORSA"],
  FORD: ["KA", "FIESTA", "FOCUS", "ECOSPORT", "RANGER", "TRANSIT", "FUSION", "EDGE", "TERRITORY", "MAVERICK", "F250", "F4000", "CARGO"],
  TOYOTA: ["COROLLA", "HILUX", "ETIOS", "YARIS", "RAV4", "SW4", "CAMRY", "BANDEIRANTE"],
  HYUNDAI: ["HB20", "CRETA", "TUCSON", "IX35", "SANTA", "HR"],
  RENAULT: ["SANDERO", "LOGAN", "DUSTER", "KWID", "CAPTUR", "KANGOO", "MASTER", "OROCH", "CLIO", "MEGANE", "SCENIC"],
  PEUGEOT: ["208", "2008", "3008", "PARTNER", "BOXER", "EXPERT", "307", "206", "207"],
  CITROEN: ["C3", "C4", "BERLINGO", "JUMPER", "JUMPY", "AIRCROSS"],
  MERCEDES: ["SPRINTER", "VITO", "ATEGO", "AXOR", "ACTROS", "ACCELO"],
  IVECO: ["DAILY", "TECTOR", "CURSOR", "STRALIS", "VERTIS"],
  SCANIA: ["P310", "P360", "R440", "R450", "R500", "G360"],
  VOLVO: ["FH", "FM", "VM", "FMX", "NH"],
  MAN: ["TGX", "TGS", "VW"],
  HONDA: ["CIVIC", "FIT", "HRV", "WRV", "CRV", "CITY", "ACCORD", "CG", "BIZ", "NXR", "XRE", "CRF", "PCX", "CBR"],
  YAMAHA: ["FAZER", "FACTOR", "LANDER", "TENERE", "XTZ", "YBR", "NMAX", "NEO"],
  MITSUBISHI: ["L200", "PAJERO", "OUTLANDER", "ASX", "LANCER"],
  NISSAN: ["FRONTIER", "KICKS", "VERSA", "MARCH", "SENTRA"],
  KIA: ["SPORTAGE", "CERATO", "SORENTO", "SOUL", "PICANTO"],
  JEEP: ["RENEGADE", "COMPASS", "COMMANDER", "WRANGLER"],
  AGRALE: ["MARRUÁ", "MARRUA", "8500", "9200", "14000"],
};

const VEHICLE_TYPES = [
  "CAMINHAO", "CAMINHÃO", "AMBULANCIA", "AMBULÂNCIA", "ONIBUS", "ÔNIBUS",
  "MOTOCICLETA", "MOTO", "TRATOR", "RETROESCAVADEIRA", "PA CARREGADEIRA",
  "MICRO ONIBUS", "MICRO ÔNIBUS", "VAN", "UTILITARIO", "UTILITÁRIO",
  "ESCAVADEIRA", "ROLO COMPACTADOR", "MOTONIVELADORA",
];

function extractContextQualifiers(procurementDesc: string): string {
  if (!procurementDesc) return "";
  const upper = procurementDesc.toUpperCase().replace(/[^A-Z0-9\s]/g, " ").replace(/\s+/g, " ");

  for (const [brand, models] of Object.entries(VEHICLE_BRANDS)) {
    const brandIdx = upper.indexOf(brand);
    if (brandIdx === -1) continue;

    const afterBrand = upper.slice(brandIdx + brand.length).trim();
    for (const model of models) {
      if (afterBrand.startsWith(model) || afterBrand.startsWith(` ${model}`)) {
        return `${brand} ${model}`;
      }
    }

    const nextWord = afterBrand.split(/\s+/)[0] ?? "";
    if (nextWord.length >= 2 && /^[A-Z0-9]+$/.test(nextWord)) {
      return `${brand} ${nextWord}`;
    }

    return brand;
  }

  for (const vtype of VEHICLE_TYPES) {
    if (upper.includes(vtype)) {
      const norm = vtype
        .replace("Ã", "A").replace("Õ", "O").replace("Á", "A")
        .replace(/[^A-Z0-9 ]/g, "");
      return norm;
    }
  }

  return "";
}

type Confidence = "high" | "medium" | "low";

function getConfidence(sampleSize: number): Confidence {
  if (sampleSize >= 10) return "high";
  if (sampleSize >= 5) return "medium";
  return "low";
}

// ===========================================================================
// Main entry — runs Pass 1 (statistics) then Pass 2 (agent-routed alerting)
// ===========================================================================

export async function analyzeOverpricing() {
  return runJob("analyze-overpricing", "analysis", async () => {
    let recordsOut = 0;

    // Pass 1: populate PriceAnalysis rows (statistical baselines). No alerts.
    const stat1 = [analyzeByMarketPrice, analyzeByCatmat, analyzeByDescription, analyzeBidSpread];
    for (const strategy of stat1) {
      let batchOut = 0;
      do {
        batchOut = await strategy();
        recordsOut += batchOut;
      } while (batchOut >= BATCH_SIZE);
    }

    // Pass 2: route through the evaluator agent and create alerts only when
    // it decides "create". This is the single place that creates OVERPRICING alerts.
    let evalBatch = 0;
    do {
      evalBatch = await evaluateAndAlert();
      recordsOut += evalBatch;
    } while (evalBatch >= EVAL_BATCH_SIZE);

    return { recordsIn: 0, recordsOut };
  });
}

// ---------------------------------------------------------------------------
// Pass 1: statistical strategies — populate PriceAnalysis rows only.
// Alerts are NOT created here.
// ---------------------------------------------------------------------------

async function analyzeByMarketPrice(): Promise<number> {
  const items = await prisma.procurementItem.findMany({
    where: {
      priceAnalyses: { none: { method: "market_price" } },
      unitPrice: { gt: 0 },
      priceReferences: { some: {} },
    },
    include: {
      priceReferences: true,
      procurement: { select: { id: true, orgName: true, description: true } },
    },
    take: BATCH_SIZE,
  });

  let out = 0;

  for (const item of items) {
    const refPrices = item.priceReferences
      .map((r) => Number(r.price))
      .filter((p) => p > 0)
      .sort((a, b) => a - b);

    if (refPrices.length === 0) continue;

    const unitPrice = Number(item.unitPrice);
    const median = refPrices[Math.floor(refPrices.length / 2)]!;
    const avg = refPrices.reduce((a, b) => a + b, 0) / refPrices.length;
    const deviation = median > 0 ? (unitPrice - median) / median : 0;
    const confidence = getConfidence(refPrices.length);

    const isOverpriced = deviation > IQR_DEVIATION_THRESHOLD;
    const context = extractContextQualifiers(item.procurement?.description ?? "");

    await createPriceAnalysis(item.id, {
      method: "market_price",
      isOverpriced,
      deviation: deviation * 100,
      medianGovPrice: median,
      avgMarketPrice: avg,
      details: {
        unitPrice,
        medianReference: median,
        avgReference: avg,
        referenceCount: refPrices.length,
        allReferencePrices: refPrices,
        deviationPct: Math.round(deviation * 10000) / 100,
        confidence,
        context: context || null,
        source: "PNCP_ATA",
      },
    });

    out++;
  }

  return out;
}

async function analyzeByCatmat(): Promise<number> {
  const items = await prisma.procurementItem.findMany({
    where: {
      priceAnalyses: { none: {} },
      catmatCode: { not: null },
      unitPrice: { gt: 0 },
    },
    include: {
      procurement: { select: { id: true, orgName: true, description: true } },
    },
    take: BATCH_SIZE,
  });

  if (items.length === 0) return 0;

  let out = 0;
  const catmatGroups = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.catmatCode) continue;
    const group = catmatGroups.get(item.catmatCode) ?? [];
    group.push(item);
    catmatGroups.set(item.catmatCode, group);
  }

  for (const [catmatCode, groupItems] of catmatGroups) {
    const allPrices = await prisma.procurementItem.findMany({
      where: { catmatCode, unitPrice: { gt: 0 } },
      select: { unitPrice: true },
    });

    out += await runIqrAnalysis(
      allPrices.map((i) => Number(i.unitPrice)),
      groupItems,
      "catmat_iqr",
      { catmatCode }
    );
  }

  return out;
}

async function analyzeByDescription(): Promise<number> {
  const items = await prisma.procurementItem.findMany({
    where: {
      priceAnalyses: { none: {} },
      catmatCode: null,
      unitPrice: { gt: 0 },
      catalogCode: { not: null },
    },
    include: {
      procurement: { select: { id: true, orgName: true, description: true } },
    },
    take: BATCH_SIZE,
  });

  if (items.length === 0) return 0;

  let out = 0;

  const contextGroups = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.catalogCode) continue;
    const descKey = item.catalogCode.slice(0, 80);
    const context = extractContextQualifiers(item.procurement?.description ?? "");
    const compositeKey = context ? `${descKey}|${context}` : descKey;
    const group = contextGroups.get(compositeKey) ?? [];
    group.push(item);
    contextGroups.set(compositeKey, group);
  }

  for (const [compositeKey, groupItems] of contextGroups) {
    const pipeIdx = compositeKey.indexOf("|");
    const descKey = pipeIdx >= 0 ? compositeKey.slice(0, pipeIdx) : compositeKey;
    const context = pipeIdx >= 0 ? compositeKey.slice(pipeIdx + 1) : "";

    let contextPrices: { unitPrice: Prisma.Decimal }[] = [];

    if (context) {
      contextPrices = await prisma.procurementItem.findMany({
        where: {
          catalogCode: { startsWith: descKey },
          unitPrice: { gt: 0 },
          procurement: { description: { contains: context, mode: "insensitive" } },
        },
        select: { unitPrice: true },
      });
    }

    const contextSampleSize = contextPrices.length;
    const confidence = getConfidence(contextSampleSize);

    if (contextSampleSize >= DESC_MIN_GROUP_SIZE) {
      out += await runIqrAnalysis(
        contextPrices.map((i) => Number(i.unitPrice)),
        groupItems,
        "description_iqr",
        { descriptionKey: descKey, context, confidence, contextSampleSize },
      );
      continue;
    }

    const allPrices = await prisma.procurementItem.findMany({
      where: { catalogCode: { startsWith: descKey }, unitPrice: { gt: 0 } },
      select: { unitPrice: true },
    });

    if (allPrices.length < DESC_MIN_GROUP_SIZE) {
      for (const item of groupItems) {
        await createPriceAnalysis(item.id, {
          method: "description_insufficient_data",
          isOverpriced: false,
          deviation: 0,
          details: {
            descriptionKey: descKey,
            context: context || null,
            contextSampleSize,
            globalSampleSize: allPrices.length,
          },
        });
      }
      out += groupItems.length;
      continue;
    }

    if (context) {
      const globalMedian = getMedian(allPrices.map((i) => Number(i.unitPrice)));

      for (const item of groupItems) {
        const unitPrice = Number(item.unitPrice);
        const deviation = globalMedian > 0 ? (unitPrice - globalMedian) / globalMedian : 0;

        await createPriceAnalysis(item.id, {
          method: "description_iqr",
          isOverpriced: false,
          deviation: deviation * 100,
          medianGovPrice: globalMedian,
          details: {
            descriptionKey: descKey,
            context,
            confidence: "low" as Confidence,
            contextSampleSize,
            globalSampleSize: allPrices.length,
            globalMedian,
            unitPrice,
            note: `Contexto "${context}" tem apenas ${contextSampleSize} item(ns) — comparação insuficiente. Mediana geral (sem contexto): R$${globalMedian.toFixed(2)}`,
          },
        });
      }
      out += groupItems.length;
      continue;
    }

    out += await runIqrAnalysis(
      allPrices.map((i) => Number(i.unitPrice)),
      groupItems,
      "description_iqr",
      { descriptionKey: descKey, context: null, confidence: getConfidence(allPrices.length), contextSampleSize: 0 },
    );
  }

  return out;
}

async function analyzeBidSpread(): Promise<number> {
  const items = await prisma.procurementItem.findMany({
    where: {
      priceAnalyses: { none: { method: "bid_spread" } },
      unitPrice: { gt: 0 },
      bidResults: { some: {} },
    },
    include: {
      bidResults: {
        orderBy: { unitPrice: "asc" },
        where: { unitPrice: { gt: 0 } },
      },
      procurement: { select: { id: true, orgName: true, description: true } },
    },
    take: BATCH_SIZE,
  });

  let out = 0;

  for (const item of items) {
    const bids = item.bidResults.map((b) => Number(b.unitPrice)).filter((p) => p > 0);
    if (bids.length < 1) continue;

    const estimatedPrice = Number(item.unitPrice);
    const winningBid = bids[0]!;
    const maxBid = bids[bids.length - 1]!;

    const estimateDeviation = estimatedPrice > 0
      ? ((winningBid - estimatedPrice) / estimatedPrice)
      : 0;

    const bidSpreadRatio = winningBid > 0 ? maxBid / winningBid : 0;

    const isOverpriced =
      estimateDeviation > IQR_DEVIATION_THRESHOLD ||
      bidSpreadRatio > BID_SPREAD_THRESHOLD;

    await createPriceAnalysis(item.id, {
      method: "bid_spread",
      isOverpriced,
      deviation: estimateDeviation * 100,
      medianGovPrice: estimatedPrice,
      details: {
        estimatedPrice,
        winningBid,
        maxBid,
        bidCount: bids.length,
        bidSpreadRatio: Math.round(bidSpreadRatio * 100) / 100,
        estimateDeviation: Math.round(estimateDeviation * 10000) / 100,
        allBids: bids,
      },
    });

    out++;
  }

  return out;
}

// ---------------------------------------------------------------------------
// IQR analysis — shared by CATMAT and description strategies (Pass 1)
// ---------------------------------------------------------------------------

async function runIqrAnalysis(
  allPrices: number[],
  items: { id: string; unitPrice: Prisma.Decimal; procurement: { id: string; orgName: string; description: string } | null; description: string }[],
  method: string,
  extraDetails: Record<string, unknown>,
): Promise<number> {
  const prices = allPrices.filter((p) => p > 0).sort((a, b) => a - b);
  if (prices.length < 3) return 0;

  const q1 = prices[Math.floor(prices.length * 0.25)]!;
  const median = prices[Math.floor(prices.length * 0.5)]!;
  const q3 = prices[Math.floor(prices.length * 0.75)]!;
  const iqr = q3 - q1;
  const upperBound = q3 + 1.5 * iqr;

  const confidence = (extraDetails.confidence as Confidence | undefined) ?? getConfidence(prices.length);

  let out = 0;

  for (const item of items) {
    const unitPrice = Number(item.unitPrice);
    const deviation = median > 0 ? (unitPrice - median) / median : 0;
    const isOverpriced = unitPrice > upperBound || deviation > IQR_DEVIATION_THRESHOLD;

    await createPriceAnalysis(item.id, {
      method,
      isOverpriced,
      deviation: deviation * 100,
      medianGovPrice: median,
      details: {
        ...extraDetails,
        confidence,
        sampleSize: prices.length,
        q1, median, q3, iqr, upperBound, unitPrice,
      },
    });

    out++;
  }

  return out;
}

// ===========================================================================
// Pass 2: routed evaluator — agent decides whether to create the alert.
// ===========================================================================

/**
 * Selects items that (a) have at least one PriceAnalysis flagged as overpriced
 * OR (b) are classified SERVICE/GENERIC and have not been evaluated yet.
 * For each, invokes the Claude evaluator. Creates an Alert only if the
 * verdict is "create".
 */
async function evaluateAndAlert(): Promise<number> {
  // Fetch items that have at least one statistical analysis flagged as overpriced.
  // We dedup by the existence of an `AiAnalysis` row (overpricing_evaluation) for
  // the item — see the check below. So the same item is processed at most once
  // even across multiple cron invocations.
  const items = await prisma.procurementItem.findMany({
    where: {
      priceAnalyses: { some: { isOverpriced: true } },
    },
    include: {
      priceAnalyses: true,
      procurement: {
        select: { id: true, orgName: true, description: true, state: true, city: true },
      },
    },
    take: EVAL_BATCH_SIZE,
  });

  let out = 0;

  for (const item of items) {
    if (!item.procurement) continue;

    // Skip if we already evaluated this item (avoid duplicate API calls)
    const existing = await prisma.aiAnalysis.findFirst({
      where: {
        targetType: "procurement_item",
        targetId: item.id,
        analysisType: "overpricing_evaluation",
      },
      select: { id: true },
    });
    if (existing) continue;

    const kind: ItemKind = classifyItem({
      description: item.description,
      materialOrService: item.materialOrService,
      materialOrServiceName: item.materialOrServiceName,
      unit: item.unit,
      catmatCode: item.catmatCode,
      catalogCode: item.catalogCode,
    });

    const bid = await prisma.bidResult.findFirst({
      where: { itemId: item.id, unitPrice: { gt: 0 } },
      orderBy: { unitPrice: "asc" },
      select: { unitPrice: true },
    });

    const input: EvaluateInput = {
      itemId: item.id,
      itemDescription: item.description,
      unit: item.unit,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
      winningBid: bid ? Number(bid.unitPrice) : null,
      estimatedPrice: Number(item.unitPrice),
      procurementId: item.procurement.id,
      procurementDescription: item.procurement.description ?? "",
      orgName: item.procurement.orgName,
      state: item.procurement.state,
      city: item.procurement.city,
      kind,
      priceAnalyses: item.priceAnalyses.map((pa): PriceAnalysisSummary => {
        const details = (pa.details ?? {}) as Record<string, unknown>;
        return {
          method: pa.method,
          isOverpriced: pa.isOverpriced,
          deviation: Number(pa.deviation),
          medianGovPrice: pa.medianGovPrice ? Number(pa.medianGovPrice) : null,
          sampleSize: (details.sampleSize as number | undefined) ?? (details.referenceCount as number | undefined),
          confidence: details.confidence as ("high" | "medium" | "low") | undefined,
        };
      }),
    };

    const verdict = await evaluateOverpricing(input);

    await persistEvaluation(input, kind, verdict);

    if (verdict.decision === "create" && verdict.severity) {
      await createAlertFromVerdict(input, kind, verdict);
    }

    out++;
  }

  return out;
}

async function persistEvaluation(
  input: EvaluateInput,
  kind: ItemKind,
  verdict: EvaluateVerdict,
): Promise<void> {
  try {
    await prisma.aiAnalysis.create({
      data: {
        targetType: "procurement_item",
        targetId: input.itemId,
        analysisType: "overpricing_evaluation",
        prompt: verdict.prompt,
        response: verdict.response,
        riskScore: verdict.riskScore,
        findings: {
          decision: verdict.decision,
          severity: verdict.severity ?? null,
          kind,
          enrichedItemLabel: verdict.enrichedItemLabel ?? null,
          derivedEstimate: verdict.derivedEstimate ?? null,
          reasoning: verdict.reasoning,
        } as unknown as Prisma.InputJsonValue,
        model: "claude-sonnet-4-20250514",
        tokens: verdict.modelTokens,
        procurementId: input.procurementId,
      },
    });
  } catch (err) {
    console.error("[analyze-overpricing] failed to persist evaluation", err);
  }
}

async function createAlertFromVerdict(
  input: EvaluateInput,
  kind: ItemKind,
  verdict: EvaluateVerdict,
): Promise<void> {
  // Pick template: market when there's a statistical baseline, contextual when agent derived an estimate.
  const hasDerivedEstimate = !!verdict.derivedEstimate;
  const flaggedStatAnalysis = input.priceAnalyses.find((pa) => pa.isOverpriced);

  const itemDescPtBr = verdict.enrichedItemLabel?.ptBr ?? input.itemDescription.slice(0, 100);
  const itemDescEn = verdict.enrichedItemLabel?.en;

  let titleKey: string;
  let descriptionKey: string;
  let params: Record<string, AlertI18nParam>;

  if (hasDerivedEstimate && verdict.derivedEstimate) {
    titleKey = "alerts.templates.overpricingContextual.title";
    descriptionKey = "alerts.templates.overpricingContextual.description";
    const total = input.totalPrice;
    const expected = verdict.derivedEstimate.expectedPrice;
    const deviation = expected > 0 ? ((total - expected) / expected) * 100 : 0;
    params = {
      itemDescription: itemDescPtBr,
      orgName: input.orgName,
      totalPrice: `R$${total.toFixed(2)}`,
      expectedPrice: `R$${expected.toFixed(2)}`,
      minPrice: `R$${verdict.derivedEstimate.minPrice.toFixed(2)}`,
      maxPrice: `R$${verdict.derivedEstimate.maxPrice.toFixed(2)}`,
      deviationPct: deviation.toFixed(0),
      // Raw code — translated per locale on the frontend via CODE_PARAM_GROUPS.
      kind,
    };
  } else if (flaggedStatAnalysis) {
    titleKey = "alerts.templates.overpricingMarket.title";
    descriptionKey = "alerts.templates.overpricingMarket.description";
    const median = flaggedStatAnalysis.medianGovPrice ?? input.unitPrice;
    params = {
      deviationPct: flaggedStatAnalysis.deviation.toFixed(0),
      itemDescription: itemDescPtBr,
      contextLabel: "",
      unitPrice: `R$${input.unitPrice.toFixed(2)}`,
      median: `R$${median.toFixed(2)}`,
      sampleSize: flaggedStatAnalysis.sampleSize ?? 0,
      confidence: renderCodePtBr("priceConfidence", flaggedStatAnalysis.confidence ?? "low"),
    };
  } else {
    // Agent created without statistical baseline or derived estimate — should be rare;
    // fall back to a generic contextual template.
    titleKey = "alerts.templates.overpricingContextual.title";
    descriptionKey = "alerts.templates.overpricingContextual.description";
    params = {
      itemDescription: itemDescPtBr,
      orgName: input.orgName,
      totalPrice: `R$${input.totalPrice.toFixed(2)}`,
      expectedPrice: "—",
      minPrice: "—",
      maxPrice: "—",
      deviationPct: "0",
      kind,
    };
  }

  const paramsByLocale: Record<string, Record<string, AlertI18nParam>> | undefined = itemDescEn
    ? { en: { itemDescription: itemDescEn } }
    : undefined;

  const i18n = buildAlertI18n(titleKey, descriptionKey, params, paramsByLocale);

  // Snapshot renderers (server-side) need code params pre-translated since
  // renderPtBr doesn't run through CODE_PARAM_GROUPS. Build a copy with codes
  // resolved to their pt-BR labels for the snapshot only.
  const snapshotParams: Record<string, AlertI18nParam> = {
    ...params,
    ...(typeof params.kind === "string"
      ? { kind: renderCodePtBr("itemKind", params.kind) }
      : {}),
  };

  await prisma.alert.create({
    data: {
      type: "OVERPRICING",
      severity: verdict.severity as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      title: renderPtBr(titleKey, snapshotParams),
      description: renderPtBr(descriptionKey, snapshotParams),
      procurementId: input.procurementId,
      data: {
        itemId: input.itemId,
        kind,
        unitPrice: input.unitPrice,
        totalPrice: input.totalPrice,
        derivedEstimate: verdict.derivedEstimate ?? null,
        evaluatorReasoning: verdict.reasoning,
        enrichedItemLabel: verdict.enrichedItemLabel ?? null,
        i18n,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMedian(values: number[]): number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function createPriceAnalysis(
  itemId: string,
  opts: {
    method: string;
    isOverpriced: boolean;
    deviation: number;
    medianGovPrice?: number;
    avgMarketPrice?: number;
    details: Record<string, unknown>;
  },
) {
  await prisma.priceAnalysis.create({
    data: {
      itemId,
      medianGovPrice: opts.medianGovPrice ? new Prisma.Decimal(opts.medianGovPrice) : null,
      avgMarketPrice: opts.avgMarketPrice ? new Prisma.Decimal(opts.avgMarketPrice) : null,
      deviation: opts.deviation,
      method: opts.method,
      isOverpriced: opts.isOverpriced,
      details: opts.details as unknown as Prisma.InputJsonValue,
    },
  });
}
