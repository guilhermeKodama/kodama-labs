import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { Prisma } from "@/generated/prisma";

const BATCH_SIZE = 300;
const IQR_DEVIATION_THRESHOLD = 0.3;
const BID_SPREAD_THRESHOLD = 2.0;
const DESC_MIN_GROUP_SIZE = 3;

export async function analyzeOverpricing() {
  return runJob("analyze-overpricing", "analysis", async () => {
    let recordsOut = 0;

    recordsOut += await analyzeByCatmat();
    recordsOut += await analyzeByDescription();
    recordsOut += await analyzeBidSpread();

    return { recordsIn: 0, recordsOut };
  });
}

/**
 * Strategy 1: CATMAT-based IQR analysis
 * Groups items by their CATMAT material code and flags outliers using IQR.
 */
async function analyzeByCatmat(): Promise<number> {
  const items = await prisma.procurementItem.findMany({
    where: {
      priceAnalyses: { none: {} },
      catmatCode: { not: null },
      unitPrice: { gt: 0 },
    },
    include: {
      procurement: { select: { id: true, orgName: true } },
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
 * Strategy 2: Description-based similarity analysis
 * Normalizes descriptions, groups identical/similar ones, and runs IQR.
 * Uses the catalogCode field which stores the normalized description.
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
      procurement: { select: { id: true, orgName: true } },
    },
    take: BATCH_SIZE,
  });

  if (items.length === 0) return 0;

  let out = 0;
  const descGroups = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.catalogCode) continue;
    const key = item.catalogCode.slice(0, 80);
    const group = descGroups.get(key) ?? [];
    group.push(item);
    descGroups.set(key, group);
  }

  for (const [descKey, groupItems] of descGroups) {
    const allPrices = await prisma.procurementItem.findMany({
      where: {
        catalogCode: { startsWith: descKey },
        unitPrice: { gt: 0 },
      },
      select: { unitPrice: true },
    });

    if (allPrices.length < DESC_MIN_GROUP_SIZE) {
      for (const item of groupItems) {
        await createPriceAnalysis(item.id, {
          method: "description_insufficient_data",
          isOverpriced: false,
          deviation: 0,
          details: { descriptionKey: descKey, sampleSize: allPrices.length },
        });
      }
      out += groupItems.length;
      continue;
    }

    out += await runIqrAnalysis(
      allPrices.map((i) => Number(i.unitPrice)),
      groupItems,
      "description_iqr",
      { descriptionKey: descKey }
    );
  }

  return out;
}

/**
 * Strategy 3: Bid spread analysis
 * For items with multiple bids, compares the winning (lowest) bid to
 * the estimated price and detects anomalous spreads between bidders.
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
      procurement: { select: { id: true, orgName: true } },
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
      const reason = estimateDeviation > IQR_DEVIATION_THRESHOLD
        ? `Preço vencedor R$${winningBid.toFixed(2)} é ${(estimateDeviation * 100).toFixed(0)}% acima do estimado R$${estimatedPrice.toFixed(2)}`
        : `Spread entre lances suspeito: lance máximo ${bidSpreadRatio.toFixed(1)}x o lance mínimo`;

      const existingBidAlert = await prisma.alert.findFirst({
        where: { type: "OVERPRICING", data: { path: ["itemId"], equals: item.id } },
      });

      if (!existingBidAlert) await prisma.alert.create({
        data: {
          type: "OVERPRICING",
          severity: severity as "MEDIUM" | "HIGH" | "CRITICAL",
          title: `Sobrepreço em lances: ${item.description.slice(0, 80)}`,
          description: `${reason}. Item "${item.description.slice(0, 120)}" na licitação de ${item.procurement.orgName}. ${bids.length} lance(s) registrado(s).`,
          procurementId: item.procurement.id,
          data: {
            method: "bid_spread",
            itemId: item.id,
            estimatedPrice,
            winningBid,
            bidSpreadRatio,
            estimateDeviation: estimateDeviation * 100,
          },
        },
      });
    }

    out++;
  }

  return out;
}

async function runIqrAnalysis(
  allPrices: number[],
  items: { id: string; unitPrice: Prisma.Decimal; procurement: { id: string; orgName: string } | null; description: string }[],
  method: string,
  extraDetails: Record<string, unknown>
): Promise<number> {
  const prices = allPrices.filter((p) => p > 0).sort((a, b) => a - b);
  if (prices.length < 3) return 0;

  const q1 = prices[Math.floor(prices.length * 0.25)]!;
  const median = prices[Math.floor(prices.length * 0.5)]!;
  const q3 = prices[Math.floor(prices.length * 0.75)]!;
  const iqr = q3 - q1;
  const upperBound = q3 + 1.5 * iqr;

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
        sampleSize: prices.length,
        q1,
        median,
        q3,
        iqr,
        upperBound,
        unitPrice,
      },
    });

    if (isOverpriced && item.procurement) {
      await prisma.alert.create({
        data: {
          type: "OVERPRICING",
          severity: deviation > 1 ? "CRITICAL" : deviation > 0.5 ? "HIGH" : "MEDIUM",
          title: `Sobrepreço: ${(deviation * 100).toFixed(0)}% acima da mediana (${method})`,
          description: `Item "${item.description.slice(0, 120)}" com preço R$${unitPrice.toFixed(2)} está ${(deviation * 100).toFixed(0)}% acima da mediana R$${median.toFixed(2)} (amostra: ${prices.length}).`,
          procurementId: item.procurement.id,
          data: {
            method,
            itemId: item.id,
            unitPrice,
            median,
            deviation: deviation * 100,
            sampleSize: prices.length,
          },
        },
      });
    }

    out++;
  }

  return out;
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
  }
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
