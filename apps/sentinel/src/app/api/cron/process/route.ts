import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { processProcurements } from "@sentinel/server/modules/pipeline/processing/process-procurements";
import { processContracts } from "@sentinel/server/modules/pipeline/processing/process-contracts";
import { processItems } from "@sentinel/server/modules/pipeline/processing/process-items";
import { processEntities } from "@sentinel/server/modules/pipeline/processing/process-entities";
import { linkData } from "@sentinel/server/modules/pipeline/processing/link-data";
import { processPoliticians } from "@sentinel/server/modules/pipeline/processing/process-politicians";
import { processDonations } from "@sentinel/server/modules/pipeline/processing/process-donations";
import { processAssets } from "@sentinel/server/modules/pipeline/processing/process-assets";
import { processServidores } from "@sentinel/server/modules/pipeline/processing/process-servidores";
import type { JobResult } from "@sentinel/server/lib/job-runner";

export const maxDuration = 300;

const BUDGET_MS = (maxDuration - 50) * 1000;
const MODULE_TIMEOUT_MS = 120_000;
const IDLE_THRESHOLD = 10;

type ModuleOutcome = { name: string; result?: JobResult; error?: string };

const modules: { name: string; fn: () => Promise<{ success: boolean; result?: JobResult; error?: string }> }[] = [
  { name: "procurements", fn: processProcurements },
  { name: "contracts", fn: processContracts },
  { name: "items", fn: processItems },
  { name: "entities", fn: processEntities },
  { name: "linking", fn: linkData },
  { name: "politicians", fn: processPoliticians },
  { name: "donations", fn: processDonations },
  { name: "assets", fn: processAssets },
  { name: "servidores", fn: processServidores },
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
    if (perModuleTimeout < 5_000) break;

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
