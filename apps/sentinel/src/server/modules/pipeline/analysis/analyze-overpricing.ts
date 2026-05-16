import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { Prisma } from "@/generated/prisma";
import {
  buildAlertI18n,
  renderCodePtBr,
  renderPtBr,
} from "@sentinel/server/lib/alert-i18n";

const BATCH_SIZE = 300;
const IQR_DEVIATION_THRESHOLD = 0.3;
const BID_SPREAD_THRESHOLD = 2.0;
const DESC_MIN_GROUP_SIZE = 5;

// ---------------------------------------------------------------------------
// Context extraction — prevents false positives by qualifying comparisons
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

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function analyzeOverpricing() {
  return runJob("analyze-overpricing", "analysis", async () => {
    let recordsOut = 0;

    const strategies = [analyzeByMarketPrice, analyzeByCatmat, analyzeByDescription, analyzeBidSpread];

    for (const strategy of strategies) {
      let batchOut = 0;
      do {
        batchOut = await strategy();
        recordsOut += batchOut;
      } while (batchOut >= BATCH_SIZE);
    }

    return { recordsIn: 0, recordsOut };
  });
}

/**
 * Strategy 0: Market price comparison using PriceReference data from PNCP Atas
 */
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

    if (isOverpriced && item.procurement && (confidence === "high" || confidence === "medium")) {
      const severity = deviation > 1 ? "CRITICAL" : deviation > 0.5 ? "HIGH" : "MEDIUM";

      const existing = await prisma.alert.findFirst({
        where: {
          type: "OVERPRICING",
          data: { path: ["itemId"], equals: item.id },
        },
      });

      if (!existing) {
        const contextLabel = context ? ` (contexto: ${context})` : "";
        const i18nParams = {
          deviationPct: (deviation * 100).toFixed(0),
          itemDescription: item.description.slice(0, 100),
          contextLabel,
          unitPrice: `R$${unitPrice.toFixed(2)}`,
          median: `R$${median.toFixed(2)}`,
          sampleSize: refPrices.length,
          confidence: renderCodePtBr("priceConfidence", confidence),
        };
        const i18n = buildAlertI18n(
          "alerts.templates.overpricingMarket.title",
          "alerts.templates.overpricingMarket.description",
          { ...i18nParams, confidence },
        );

        await prisma.alert.create({
          data: {
            type: "OVERPRICING",
            severity: severity as "MEDIUM" | "HIGH" | "CRITICAL",
            title: renderPtBr("alerts.templates.overpricingMarket.title", i18nParams),
            description: renderPtBr("alerts.templates.overpricingMarket.description", i18nParams),
            procurementId: item.procurement.id,
            data: {
              method: "market_price",
              itemId: item.id,
              unitPrice,
              medianReference: median,
              deviation: deviation * 100,
              referenceCount: refPrices.length,
              confidence,
              context: context || null,
              source: "PNCP_ATA",
              i18n,
            },
          },
        });
      }
    }

    out++;
  }

  return out;
}

/**
 * Strategy 1: CATMAT-based IQR analysis
 */
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

/**
 * Strategy 2: Context-aware description-based similarity analysis.
 * Extracts qualifiers from the parent procurement description (vehicle model,
 * brand, equipment type) and uses them as part of the comparison grouping key
 * so items are only compared against truly equivalent items.
 */
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

/**
 * Strategy 3: Bid spread analysis
 */
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

    const severity = estimateDeviation > 1
      ? "CRITICAL" : estimateDeviation > 0.5
      ? "HIGH" : "MEDIUM";

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

    if (isOverpriced && item.procurement) {
      const useEstimate = estimateDeviation > IQR_DEVIATION_THRESHOLD;
      const titleKey = useEstimate
        ? "alerts.templates.overpricingBidEstimate.title"
        : "alerts.templates.overpricingBidSpread.title";
      const descriptionKey = useEstimate
        ? "alerts.templates.overpricingBidEstimate.description"
        : "alerts.templates.overpricingBidSpread.description";

      const i18nParams: Record<string, string | number> = useEstimate
        ? {
            winningBid: `R$${winningBid.toFixed(2)}`,
            estimatedPrice: `R$${estimatedPrice.toFixed(2)}`,
            deviationPct: (estimateDeviation * 100).toFixed(0),
            itemDescription: item.description.slice(0, 120),
            orgName: item.procurement.orgName,
            bidCount: bids.length,
          }
        : {
            bidSpreadRatio: bidSpreadRatio.toFixed(1),
            itemDescription: item.description.slice(0, 120),
            orgName: item.procurement.orgName,
            bidCount: bids.length,
          };

      const i18n = buildAlertI18n(titleKey, descriptionKey, i18nParams);

      const existingBidAlert = await prisma.alert.findFirst({
        where: { type: "OVERPRICING", data: { path: ["itemId"], equals: item.id } },
      });

      if (!existingBidAlert) await prisma.alert.create({
        data: {
          type: "OVERPRICING",
          severity: severity as "MEDIUM" | "HIGH" | "CRITICAL",
          title: renderPtBr(titleKey, i18nParams),
          description: renderPtBr(descriptionKey, i18nParams),
          procurementId: item.procurement.id,
          data: {
            method: "bid_spread",
            itemId: item.id,
            estimatedPrice,
            winningBid,
            bidSpreadRatio,
            estimateDeviation: estimateDeviation * 100,
            i18n,
          },
        },
      });
    }

    out++;
  }

  return out;
}

// ---------------------------------------------------------------------------
// IQR analysis — shared by CATMAT and description strategies
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

  const confidence = extraDetails.confidence as Confidence | undefined ?? getConfidence(prices.length);

  let out = 0;

  for (const item of items) {
    const unitPrice = Number(item.unitPrice);
    const deviation = median > 0 ? (unitPrice - median) / median : 0;
    const isOverpriced = unitPrice > upperBound || deviation > IQR_DEVIATION_THRESHOLD;

    const context = extraDetails.context as string | null | undefined ?? "";

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

    if (isOverpriced && item.procurement && (confidence === "high" || confidence === "medium")) {
      const existingIqrAlert = await prisma.alert.findFirst({
        where: { type: "OVERPRICING", data: { path: ["itemId"], equals: item.id } },
      });
      if (!existingIqrAlert) {
        const contextLabel = context ? ` (contexto: ${context})` : "";
        const fallbackParams = {
          deviationPct: (deviation * 100).toFixed(0),
          itemDescription: item.description.slice(0, 100),
          contextLabel,
          unitPrice: `R$${unitPrice.toFixed(2)}`,
          median: `R$${median.toFixed(2)}`,
          sampleSize: prices.length,
          confidence: renderCodePtBr("priceConfidence", confidence),
          method: renderCodePtBr("priceAnalysisMethod", method),
        };
        const i18n = buildAlertI18n(
          "alerts.templates.overpricingIqr.title",
          "alerts.templates.overpricingIqr.description",
          { ...fallbackParams, confidence, method },
        );

        await prisma.alert.create({
          data: {
            type: "OVERPRICING",
            severity: deviation > 1 ? "CRITICAL" : deviation > 0.5 ? "HIGH" : "MEDIUM",
            title: renderPtBr("alerts.templates.overpricingIqr.title", fallbackParams),
            description: renderPtBr("alerts.templates.overpricingIqr.description", fallbackParams),
            procurementId: item.procurement.id,
            data: {
              method,
              itemId: item.id,
              unitPrice,
              median,
              deviation: deviation * 100,
              sampleSize: prices.length,
              confidence,
              context: context || null,
              i18n,
            },
          },
        });
      }
    }

    out++;
  }

  return out;
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
