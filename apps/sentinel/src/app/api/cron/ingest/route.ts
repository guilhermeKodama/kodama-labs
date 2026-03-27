import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { ingestPncp, ingestPncpContratos } from "@sentinel/server/modules/pipeline/ingestion/ingest-pncp";
import { ingestPncpDetails } from "@sentinel/server/modules/pipeline/ingestion/ingest-pncp-details";
import { ingestSanctions } from "@sentinel/server/modules/pipeline/ingestion/ingest-sanctions";
import { ingestCnpj } from "@sentinel/server/modules/pipeline/ingestion/ingest-cnpj";
import { ingestPoliticians } from "@sentinel/server/modules/pipeline/ingestion/ingest-politicians";
import { ingestDonations } from "@sentinel/server/modules/pipeline/ingestion/ingest-donations";
import { ingestAssets } from "@sentinel/server/modules/pipeline/ingestion/ingest-assets";
import { ingestServidores } from "@sentinel/server/modules/pipeline/ingestion/ingest-servidores";
import { ingestTransparencia } from "@sentinel/server/modules/pipeline/ingestion/ingest-transparencia";
import { ingestSenadores } from "@sentinel/server/modules/pipeline/ingestion/ingest-senadores";
import { ingestPriceReferences } from "@sentinel/server/modules/pipeline/ingestion/ingest-price-references";
import type { JobResult } from "@sentinel/server/lib/job-runner";

export const maxDuration = 300;

const BUDGET_MS = (maxDuration - 60) * 1000;
const MODULE_TIMEOUT_MS = 120_000;
const IDLE_THRESHOLD = 5;

type ModuleOutcome = { name: string; result?: JobResult; error?: string };

const modules: { name: string; fn: () => Promise<{ success: boolean; result?: JobResult; error?: string }> }[] = [
  { name: "pncp", fn: ingestPncp },
  { name: "pncpContracts", fn: ingestPncpContratos },
  { name: "pncpDetails", fn: ingestPncpDetails },
  { name: "sanctions", fn: ingestSanctions },
  { name: "transparencia", fn: ingestTransparencia },
  { name: "cnpj", fn: ingestCnpj },
  { name: "politicians", fn: ingestPoliticians },
  { name: "senadores", fn: ingestSenadores },
  { name: "donations", fn: ingestDonations },
  { name: "assets", fn: ingestAssets },
  { name: "servidores", fn: ingestServidores },
  { name: "priceReferences", fn: ingestPriceReferences },
];

function withTimeout(
  name: string,
  fn: () => Promise<{ success: boolean; result?: JobResult; error?: string }>,
  timeoutMs = MODULE_TIMEOUT_MS
): Promise<ModuleOutcome> {
  return Promise.race([
    fn().then(({ result, error }) => ({ name, result: result ?? undefined, error })),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs / 1000}s`)), timeoutMs)
    ),
  ]).catch((err) => ({
    name,
    error: err instanceof Error ? err.message : "Unknown error",
  }));
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  let pass = 0;
  const accumulated: Record<string, { recordsIn: number; recordsOut: number; errors: string[] }> = {};

  for (const m of modules) {
    accumulated[m.name] = { recordsIn: 0, recordsOut: 0, errors: [] };
  }

  while (Date.now() - start < BUDGET_MS) {
    pass++;

    const remainingMs = BUDGET_MS - (Date.now() - start);
    const perModuleTimeout = Math.min(MODULE_TIMEOUT_MS, remainingMs - 5_000);
    if (perModuleTimeout < 10_000) break;

    const settled = await Promise.allSettled(
      modules.map((m) => withTimeout(m.name, m.fn, perModuleTimeout))
    );

    let totalIn = 0;

    for (const entry of settled) {
      if (entry.status === "fulfilled") {
        const { name, result, error } = entry.value;
        if (result) {
          accumulated[name].recordsIn += result.recordsIn;
          accumulated[name].recordsOut += result.recordsOut;
          totalIn += result.recordsIn;
        }
        if (error) {
          accumulated[name].errors.push(error);
        }
      }
    }

    if (totalIn < IDLE_THRESHOLD) break;
  }

  const results: Record<string, unknown> = {
    processedAt: new Date().toISOString(),
    passes: pass,
    elapsedMs: Date.now() - start,
  };

  for (const [name, data] of Object.entries(accumulated)) {
    results[name] = {
      success: data.errors.length === 0,
      result: { recordsIn: data.recordsIn, recordsOut: data.recordsOut },
      ...(data.errors.length > 0 ? { errors: data.errors } : {}),
    };
  }

  return NextResponse.json(results);
}
