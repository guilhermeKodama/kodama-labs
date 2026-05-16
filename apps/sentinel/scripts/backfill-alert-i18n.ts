/**
 * Backfill historical alerts to use the new neutral wording + i18n template keys.
 *
 * Walks every Alert row that doesn't have data.i18n yet, reconstructs the i18n
 * block from raw data fields, and rewrites title/description with the neutral
 * pt-BR templates. Optionally also rewrites aiAnalysis.response.
 *
 * Usage:
 *   cd apps/sentinel
 *   pnpm exec tsx scripts/backfill-alert-i18n.ts [options]
 *
 * Options:
 *   --dry-run                  Don't write — print counts + 5 before/after samples per type.
 *   --types=A,B                Restrict to specific AlertType values (comma-separated).
 *   --max-batches=N            Cap batches processed (safety).
 *   --batch-size=N             Page size (default 500).
 *   --clean-ai-analyses        Also rewrite aiAnalysis.response (pre-cutoff rows).
 *   --cutoff=YYYY-MM-DD        Cutoff date for aiAnalysis cleanup (default: today).
 */

import { prisma } from "../src/server/lib/prisma";
import {
  buildAlertI18n,
  renderCodeListPtBr,
  renderCodePtBr,
  renderPtBr,
  type AlertI18nParam,
} from "../src/server/lib/alert-i18n";

type Args = {
  dryRun: boolean;
  types: Set<string> | null;
  maxBatches: number;
  batchSize: number;
  cleanAiAnalyses: boolean;
  cutoff: Date;
};

function parseArgs(): Args {
  const out: Args = {
    dryRun: false,
    types: null,
    maxBatches: Infinity,
    batchSize: 500,
    cleanAiAnalyses: false,
    cutoff: new Date(),
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--clean-ai-analyses") out.cleanAiAnalyses = true;
    else if (arg.startsWith("--types=")) {
      out.types = new Set(arg.slice("--types=".length).split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith("--max-batches=")) {
      out.maxBatches = parseInt(arg.slice("--max-batches=".length), 10);
    } else if (arg.startsWith("--batch-size=")) {
      out.batchSize = parseInt(arg.slice("--batch-size=".length), 10);
    } else if (arg.startsWith("--cutoff=")) {
      out.cutoff = new Date(arg.slice("--cutoff=".length));
    } else {
      console.error(`Unknown arg: ${arg}`);
      process.exit(1);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reconstruction
// ---------------------------------------------------------------------------

const REQUIRED_TEMPLATES = [
  "alerts.templates.shellCompany.title",
  "alerts.templates.shellCompany.description",
  "alerts.templates.sanctionedEntity.title",
  "alerts.templates.sanctionedEntity.description",
  "alerts.templates.suspiciousNetwork.title",
  "alerts.templates.suspiciousNetwork.description",
  "alerts.templates.aiFlag.title",
  "alerts.templates.aiFlag.description",
  "alerts.templates.overpricingMarket.title",
  "alerts.templates.overpricingMarket.description",
  "alerts.templates.overpricingIqr.title",
  "alerts.templates.overpricingIqr.description",
  "alerts.templates.overpricingBidEstimate.title",
  "alerts.templates.overpricingBidEstimate.description",
  "alerts.templates.overpricingBidSpread.title",
  "alerts.templates.overpricingBidSpread.description",
  "alerts.templates.politicianShareholder.title",
  "alerts.templates.politicianShareholder.description",
  "alerts.templates.supplierDonated.title",
  "alerts.templates.supplierDonated.description",
  "alerts.templates.donorGotContract.title",
  "alerts.templates.donorGotContract.description",
  "alerts.templates.familyInSupplier.title",
  "alerts.templates.familyInSupplier.description",
  "alerts.templates.familyDonated.title",
  "alerts.templates.familyDonated.description",
  "alerts.templates.politicianServant.title",
  "alerts.templates.politicianServant.description",
  "alerts.templates.wealthAnomaly.title",
  "alerts.templates.wealthAnomaly.description",
  "alerts.templates.donorIsShareholder.title",
  "alerts.templates.donorIsShareholder.description",
  "alerts.templates.donationTiming.title",
  "alerts.templates.donationTiming.description",
  "alerts.templates.donorConcentration.title",
  "alerts.templates.donorConcentration.description",
];

const AI_FALLBACK_DESCRIPTION =
  "Pontos a revisar identificados em análise anterior — recomenda-se reavaliação.";

const AI_ANALYSIS_FALLBACK_RESPONSE =
  "Análise pré-atualização de redação — texto original removido. Recomenda-se reanálise.";

function fmtBRL(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "";
  return `R$ ${n.toLocaleString("pt-BR")}`;
}

type Reconstruction = {
  titleKey: string;
  descriptionKey: string;
  params: Record<string, AlertI18nParam>;
  fallbackParams?: Record<string, AlertI18nParam>;
};

type AlertWithRelations = {
  id: string;
  type: string;
  title: string;
  description: string;
  data: unknown;
  entityId: string | null;
  contractId: string | null;
  procurementId: string | null;
  entity: { name: string; cnpj: string } | null;
  contract: { supplierName: string; supplierCnpj: string } | null;
  procurement: { orgName: string; description: string } | null;
};

class ReconstructError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

function need<T>(v: T | null | undefined, name: string): T {
  if (v === null || v === undefined) {
    throw new ReconstructError(`missing required field: ${name}`);
  }
  return v;
}

async function reconstructShellCompany(
  alert: AlertWithRelations,
  data: Record<string, unknown>,
): Promise<Reconstruction> {
  const flags = (data.flags as string[] | undefined) ?? [];
  if (flags.length === 0) throw new ReconstructError("flags array missing or empty");
  const entityName = need(alert.entity?.name, "entity.name");
  const cnpj = (alert.entity?.cnpj ?? data.entityCnpj) as string | undefined;
  if (!cnpj) throw new ReconstructError("cnpj missing");
  const params = {
    entityName,
    cnpj,
    flagCount: flags.length,
    flags: flags.join(","),
  };
  const fallbackParams = {
    ...params,
    flags: renderCodeListPtBr("shellCompanyFlag", flags),
  };
  return {
    titleKey: "alerts.templates.shellCompany.title",
    descriptionKey: "alerts.templates.shellCompany.description",
    params,
    fallbackParams,
  };
}

async function reconstructSanctionedEntity(
  alert: AlertWithRelations,
  data: Record<string, unknown>,
): Promise<Reconstruction> {
  const supplierName = need(alert.contract?.supplierName, "contract.supplierName");
  const cnpj = (alert.contract?.supplierCnpj ?? data.supplierCnpj) as string | undefined;
  if (!cnpj) throw new ReconstructError("supplier cnpj missing");
  const sanctions = (data.sanctions as { source: string }[] | undefined) ?? [];
  const sources = sanctions.map((s) => s.source).filter(Boolean).join(", ") || "fonte desconhecida";
  const contractCount = (data.contractCount as number | undefined) ?? 1;
  const params = { supplierName, cnpj, sources, contractCount };
  return {
    titleKey: "alerts.templates.sanctionedEntity.title",
    descriptionKey: "alerts.templates.sanctionedEntity.description",
    params,
  };
}

async function reconstructSuspiciousNetwork(
  alert: AlertWithRelations,
  data: Record<string, unknown>,
): Promise<Reconstruction> {
  const entitiesRaw = (data.entities as { name: string }[] | undefined) ?? [];
  const entitiesText = entitiesRaw.map((e) => e.name).filter(Boolean).join(" e ");
  if (!entitiesText) throw new ReconstructError("entities list missing");
  const shareholderCpf = need(data.shareholderCpf as string | undefined, "shareholderCpf");
  const procurementDescription =
    (data.procurementDescription as string | undefined) ?? alert.procurement?.description ?? "";
  const orgName = need(alert.procurement?.orgName, "procurement.orgName");
  const params = {
    entities: entitiesText,
    shareholderCpf,
    procurementDescription,
    orgName,
  };
  return {
    titleKey: "alerts.templates.suspiciousNetwork.title",
    descriptionKey: "alerts.templates.suspiciousNetwork.description",
    params,
  };
}

async function reconstructOverpricing(
  alert: AlertWithRelations,
  data: Record<string, unknown>,
): Promise<Reconstruction> {
  const method = need(data.method as string | undefined, "method");
  const itemId = data.itemId as string | undefined;
  const orgName = alert.procurement?.orgName ?? "";
  let itemDescription = "";
  if (itemId) {
    const item = await prisma.procurementItem.findUnique({
      where: { id: itemId },
      select: { description: true },
    });
    itemDescription = item?.description ?? "";
  }

  if (method === "market_price") {
    const unitPrice = Number(data.unitPrice ?? 0);
    const median = Number(data.medianReference ?? 0);
    const deviation = Number(data.deviation ?? 0);
    const sampleSize = Number(data.referenceCount ?? 0);
    const confidence = (data.confidence as string | undefined) ?? "low";
    const context = (data.context as string | null | undefined) ?? null;
    const contextLabel = context ? ` (contexto: ${context})` : "";
    const params = {
      deviationPct: deviation.toFixed(0),
      itemDescription: itemDescription.slice(0, 100),
      contextLabel,
      unitPrice: `R$${unitPrice.toFixed(2)}`,
      median: `R$${median.toFixed(2)}`,
      sampleSize,
      confidence,
    };
    const fallbackParams = {
      ...params,
      confidence: renderCodePtBr("priceConfidence", confidence),
    };
    return {
      titleKey: "alerts.templates.overpricingMarket.title",
      descriptionKey: "alerts.templates.overpricingMarket.description",
      params,
      fallbackParams,
    };
  }

  if (method === "catmat_iqr" || method === "description_iqr") {
    const unitPrice = Number(data.unitPrice ?? 0);
    const median = Number(data.median ?? 0);
    const deviation = Number(data.deviation ?? 0);
    const sampleSize = Number(data.sampleSize ?? 0);
    const confidence = (data.confidence as string | undefined) ?? "low";
    const context = (data.context as string | null | undefined) ?? null;
    const contextLabel = context ? ` (contexto: ${context})` : "";
    const params = {
      deviationPct: deviation.toFixed(0),
      itemDescription: itemDescription.slice(0, 100),
      contextLabel,
      unitPrice: `R$${unitPrice.toFixed(2)}`,
      median: `R$${median.toFixed(2)}`,
      sampleSize,
      confidence,
      method,
    };
    const fallbackParams = {
      ...params,
      confidence: renderCodePtBr("priceConfidence", confidence),
      method: renderCodePtBr("priceAnalysisMethod", method),
    };
    return {
      titleKey: "alerts.templates.overpricingIqr.title",
      descriptionKey: "alerts.templates.overpricingIqr.description",
      params,
      fallbackParams,
    };
  }

  if (method === "bid_spread") {
    const estimatedPrice = Number(data.estimatedPrice ?? 0);
    const winningBid = Number(data.winningBid ?? 0);
    const estimateDeviation = Number(data.estimateDeviation ?? 0);
    const bidSpreadRatio = Number(data.bidSpreadRatio ?? 0);
    const useEstimate = estimateDeviation > 30; // threshold is 0.3 stored as *100
    if (useEstimate) {
      const params = {
        winningBid: `R$${winningBid.toFixed(2)}`,
        estimatedPrice: `R$${estimatedPrice.toFixed(2)}`,
        deviationPct: estimateDeviation.toFixed(0),
        itemDescription: itemDescription.slice(0, 120),
        orgName,
        bidCount: 0,
      };
      return {
        titleKey: "alerts.templates.overpricingBidEstimate.title",
        descriptionKey: "alerts.templates.overpricingBidEstimate.description",
        params,
      };
    } else {
      const params = {
        bidSpreadRatio: bidSpreadRatio.toFixed(1),
        itemDescription: itemDescription.slice(0, 120),
        orgName,
        bidCount: 0,
      };
      return {
        titleKey: "alerts.templates.overpricingBidSpread.title",
        descriptionKey: "alerts.templates.overpricingBidSpread.description",
        params,
      };
    }
  }

  throw new ReconstructError(`unknown overpricing method: ${method}`);
}

async function reconstructPoliticalLink(
  alert: AlertWithRelations,
  data: Record<string, unknown>,
): Promise<Reconstruction> {
  const linkType = need(data.linkType as string | undefined, "linkType");
  const politicianName = (data.politicianName as string | undefined) ?? "";
  const party = (data.party as string | undefined) ?? "";
  const state = (data.state as string | undefined) ?? "";
  const position = (data.position as string | undefined) ?? "";
  const entityName = (data.entityName as string | undefined) ?? alert.entity?.name ?? "";
  const entityCnpj = (data.entityCnpj as string | undefined) ?? alert.entity?.cnpj ?? "";

  switch (linkType) {
    case "SHAREHOLDER_IS_POLITICIAN": {
      const contractCount = Number(data.contractCount ?? 0);
      const totalContractValue = fmtBRL(data.totalContractValue as number | undefined);
      return {
        titleKey: "alerts.templates.politicianShareholder.title",
        descriptionKey: "alerts.templates.politicianShareholder.description",
        params: { politicianName, party, state, position, entityName, entityCnpj, contractCount, totalContractValue },
      };
    }
    case "SUPPLIER_DONATED": {
      const totalDonated = fmtBRL(data.totalDonated as number | undefined);
      const totalContractValue = fmtBRL(data.totalContractValue as number | undefined);
      return {
        titleKey: "alerts.templates.supplierDonated.title",
        descriptionKey: "alerts.templates.supplierDonated.description",
        params: { entityName, entityCnpj, totalDonated, politicianName, party, totalContractValue },
      };
    }
    case "DONOR_GOT_CONTRACT": {
      const donorName = (data.donorName as string | undefined) ?? entityName;
      const totalDonated = fmtBRL(data.totalDonated as number | undefined);
      const totalContractValue = fmtBRL(data.totalContractValue as number | undefined);
      return {
        titleKey: "alerts.templates.donorGotContract.title",
        descriptionKey: "alerts.templates.donorGotContract.description",
        params: { donorName, totalDonated, politicianName, party, state, totalContractValue },
      };
    }
    case "FAMILY_IN_SUPPLIER": {
      const shareholderName = need(data.shareholderName as string | undefined, "shareholderName");
      const relationship = (data.relationship as string | undefined) ?? "relative";
      const params = {
        shareholderName,
        relationshipLabel: relationship,
        politicianName,
        party,
        state,
        entityName,
        entityCnpj,
      };
      const fallbackParams = {
        ...params,
        relationshipLabel: renderCodePtBr("relationship", relationship),
      };
      return {
        titleKey: "alerts.templates.familyInSupplier.title",
        descriptionKey: "alerts.templates.familyInSupplier.description",
        params,
        fallbackParams,
      };
    }
    case "FAMILY_DONATED": {
      const donorName = need(data.donorName as string | undefined, "donorName");
      const relationship = (data.relationship as string | undefined) ?? "relative";
      const amount = fmtBRL(data.amount as number | undefined);
      const params = {
        donorName,
        relationshipLabel: relationship,
        politicianName,
        party,
        state,
        amount,
      };
      const fallbackParams = {
        ...params,
        relationshipLabel: renderCodePtBr("relationship", relationship),
      };
      return {
        titleKey: "alerts.templates.familyDonated.title",
        descriptionKey: "alerts.templates.familyDonated.description",
        params,
        fallbackParams,
      };
    }
    case "POLITICIAN_IS_SERVANT": {
      const cargo = (data.cargo as string | undefined) ?? "N/I";
      const orgao = (data.orgao as string | undefined) ?? "N/I";
      return {
        titleKey: "alerts.templates.politicianServant.title",
        descriptionKey: "alerts.templates.politicianServant.description",
        params: { politicianName, party, state, position, cargo, orgao },
      };
    }
    case "WEALTH_ANOMALY": {
      const previousTotal = fmtBRL(data.previousTotal as number | undefined);
      const previousYear = Number(data.previousYear ?? 0);
      const currentTotal = fmtBRL(data.currentTotal as number | undefined);
      const currentYear = Number(data.currentYear ?? 0);
      const growthPercentage = Number(data.growthPercentage ?? 0).toFixed(0);
      return {
        titleKey: "alerts.templates.wealthAnomaly.title",
        descriptionKey: "alerts.templates.wealthAnomaly.description",
        params: { politicianName, party, state, previousTotal, previousYear, currentTotal, currentYear, growthPercentage },
      };
    }
    case "DONOR_IS_SHAREHOLDER": {
      const donorName = need(data.donorName as string | undefined, "donorName");
      const totalDonated = fmtBRL(data.totalDonated as number | undefined);
      const totalContractValue = fmtBRL(data.totalContractValue as number | undefined);
      return {
        titleKey: "alerts.templates.donorIsShareholder.title",
        descriptionKey: "alerts.templates.donorIsShareholder.description",
        params: { donorName, totalDonated, politicianName, party, state, entityName, entityCnpj, totalContractValue },
      };
    }
    case "DONATION_TIMING": {
      const gapMonths = Number(data.gapMonths ?? 0).toFixed(0);
      const totalContractValue = fmtBRL(data.totalContractValue as number | undefined);
      // Old payload didn't store direction; default to "depois" (the analyzer's most common branch).
      const direction = (data.direction as string | undefined) ?? "depois";
      return {
        titleKey: "alerts.templates.donationTiming.title",
        descriptionKey: "alerts.templates.donationTiming.description",
        params: { entityName, politicianName, gapMonths, direction, totalContractValue },
      };
    }
    case "DONOR_CONCENTRATION": {
      const politicianCount = Number(data.politicianCount ?? 0);
      const totalDonated = fmtBRL(data.totalDonated as number | undefined);
      const contractCount = Number(data.contractCount ?? 0);
      const politicianNames = (data.politicianNames as string | undefined) ?? "";
      return {
        titleKey: "alerts.templates.donorConcentration.title",
        descriptionKey: "alerts.templates.donorConcentration.description",
        params: { politicianCount, entityName, entityCnpj, totalDonated, politicianNames, contractCount },
      };
    }
  }
  throw new ReconstructError(`unknown linkType: ${linkType}`);
}

async function reconstructAiFlag(
  alert: AlertWithRelations,
  data: Record<string, unknown>,
): Promise<Reconstruction> {
  const orgName = need(alert.procurement?.orgName, "procurement.orgName");
  const findings = (data.findings as { summary?: string } | undefined) ?? {};
  const summary = findings.summary?.slice(0, 500) ?? AI_FALLBACK_DESCRIPTION;
  const params = { orgName, summary };
  return {
    titleKey: "alerts.templates.aiFlag.title",
    descriptionKey: "alerts.templates.aiFlag.description",
    params,
  };
}

async function reconstruct(alert: AlertWithRelations): Promise<Reconstruction> {
  const data = (alert.data as Record<string, unknown> | null) ?? {};
  switch (alert.type) {
    case "SHELL_COMPANY": return reconstructShellCompany(alert, data);
    case "SANCTIONED_ENTITY": return reconstructSanctionedEntity(alert, data);
    case "SUSPICIOUS_NETWORK": return reconstructSuspiciousNetwork(alert, data);
    case "OVERPRICING": return reconstructOverpricing(alert, data);
    case "POLITICAL_LINK": return reconstructPoliticalLink(alert, data);
    case "AI_FLAG": return reconstructAiFlag(alert, data);
  }
  throw new ReconstructError(`unknown alert type: ${alert.type}`);
}

function hasExistingI18n(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const i18n = (data as Record<string, unknown>).i18n;
  if (!i18n || typeof i18n !== "object") return false;
  const obj = i18n as Record<string, unknown>;
  return typeof obj.titleKey === "string" && typeof obj.descriptionKey === "string";
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

type Stats = { rewritten: number; skipped: number; errors: number };

async function backfillAlerts(args: Args): Promise<Record<string, Stats>> {
  const statsByType: Record<string, Stats> = {};
  const samples: Record<string, { before: { title: string; description: string }; after: { title: string; description: string } }[]> = {};
  const bumpStat = (type: string, key: keyof Stats) => {
    statsByType[type] ??= { rewritten: 0, skipped: 0, errors: 0 };
    statsByType[type][key]++;
  };

  let cursor: string | undefined;
  let batches = 0;

  while (batches < args.maxBatches) {
    const where: Record<string, unknown> = {};
    if (args.types) where.type = { in: [...args.types] };

    const batch: AlertWithRelations[] = await prisma.alert.findMany({
      where,
      orderBy: { id: "asc" },
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: args.batchSize,
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        data: true,
        entityId: true,
        contractId: true,
        procurementId: true,
        entity: { select: { name: true, cnpj: true } },
        contract: { select: { supplierName: true, supplierCnpj: true } },
        procurement: { select: { orgName: true, description: true } },
      },
    });

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;

    for (const alert of batch) {
      if (hasExistingI18n(alert.data)) {
        bumpStat(alert.type, "skipped");
        continue;
      }

      try {
        const recon = await reconstruct(alert);
        const fallbackParams = recon.fallbackParams ?? recon.params;
        const newTitle = renderPtBr(recon.titleKey, fallbackParams);
        const newDescription = renderPtBr(recon.descriptionKey, fallbackParams);
        const i18n = buildAlertI18n(recon.titleKey, recon.descriptionKey, recon.params);

        if (args.dryRun) {
          samples[alert.type] ??= [];
          if (samples[alert.type]!.length < 5) {
            samples[alert.type]!.push({
              before: { title: alert.title, description: alert.description },
              after: { title: newTitle, description: newDescription },
            });
          }
        } else {
          const existingData = (alert.data as Record<string, unknown> | null) ?? {};
          await prisma.alert.update({
            where: { id: alert.id },
            data: {
              title: newTitle,
              description: newDescription,
              data: { ...existingData, i18n } as object,
            },
          });
        }
        bumpStat(alert.type, "rewritten");
      } catch (err) {
        bumpStat(alert.type, "errors");
        const reason = err instanceof ReconstructError ? err.message : String(err);
        console.error(`  ✗ ${alert.id} (${alert.type}): ${reason}`);
      }
    }

    batches++;
    const line = Object.entries(statsByType)
      .map(([t, s]) => `${t}=${s.rewritten}/${s.skipped}/${s.errors}`)
      .join("  ");
    console.log(`[backfill alerts] batch ${batches} (cursor=${cursor.slice(0, 8)}…) — type=rewritten/skipped/errors: ${line}`);

    if (batch.length < args.batchSize) break;
  }

  if (args.dryRun) {
    console.log("\n--- DRY-RUN SAMPLES ---");
    for (const [type, list] of Object.entries(samples)) {
      console.log(`\n## ${type}`);
      for (const s of list) {
        console.log(`  BEFORE: ${s.before.title}`);
        console.log(`          ${s.before.description.slice(0, 200)}`);
        console.log(`  AFTER:  ${s.after.title}`);
        console.log(`          ${s.after.description.slice(0, 200)}`);
        console.log();
      }
    }
  }

  return statsByType;
}

// ---------------------------------------------------------------------------
// aiAnalysis.response cleanup
// ---------------------------------------------------------------------------

async function cleanAiAnalyses(args: Args): Promise<{ rewritten: number; skipped: number }> {
  let cursor: string | undefined;
  let rewritten = 0;
  let skipped = 0;
  let batches = 0;

  while (batches < args.maxBatches) {
    const batch = await prisma.aiAnalysis.findMany({
      where: { createdAt: { lt: args.cutoff } },
      orderBy: { id: "asc" },
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: args.batchSize,
      select: { id: true, response: true, findings: true },
    });

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;

    for (const a of batch) {
      const findings = (a.findings as { summary?: string } | null) ?? {};
      const summary = findings.summary?.slice(0, 500);
      const newResponse = summary && summary.length > 0 ? summary : AI_ANALYSIS_FALLBACK_RESPONSE;
      if (a.response === newResponse) {
        skipped++;
        continue;
      }
      if (!args.dryRun) {
        await prisma.aiAnalysis.update({
          where: { id: a.id },
          data: { response: newResponse },
        });
      }
      rewritten++;
    }

    batches++;
    console.log(`[backfill aiAnalyses] batch ${batches} — rewritten=${rewritten} skipped=${skipped}`);

    if (batch.length < args.batchSize) break;
  }

  return { rewritten, skipped };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  for (const key of REQUIRED_TEMPLATES) {
    const rendered = renderPtBr(key);
    if (rendered === key) {
      console.error(`Missing template in pt-BR.json: ${key}`);
      process.exit(1);
    }
  }

  console.log(
    `[backfill] mode=${args.dryRun ? "DRY-RUN" : "WRITE"} batchSize=${args.batchSize}` +
    (args.types ? ` types=${[...args.types].join(",")}` : "") +
    (args.maxBatches !== Infinity ? ` maxBatches=${args.maxBatches}` : "") +
    (args.cleanAiAnalyses ? ` cleanAiAnalyses cutoff=${args.cutoff.toISOString().slice(0, 10)}` : "")
  );

  const alertStats = await backfillAlerts(args);

  console.log("\n=== ALERT SUMMARY ===");
  let totalRewritten = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  for (const [type, s] of Object.entries(alertStats)) {
    console.log(`  ${type.padEnd(22)} rewritten=${s.rewritten} skipped=${s.skipped} errors=${s.errors}`);
    totalRewritten += s.rewritten;
    totalSkipped += s.skipped;
    totalErrors += s.errors;
  }
  console.log(`  ${"TOTAL".padEnd(22)} rewritten=${totalRewritten} skipped=${totalSkipped} errors=${totalErrors}`);

  if (args.cleanAiAnalyses) {
    console.log("\n=== AI ANALYSIS RESPONSE CLEANUP ===");
    const r = await cleanAiAnalyses(args);
    console.log(`  rewritten=${r.rewritten} skipped=${r.skipped}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
