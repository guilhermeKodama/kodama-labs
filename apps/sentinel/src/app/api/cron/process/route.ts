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
import { BudgetTracker } from "@sentinel/server/lib/budget-tracker";

export const maxDuration = 300;

const BUDGET_MS = 200_000;
const MODULE_TIMEOUT_MS = 60_000;
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
  timeoutMs: number,
): Promise<ModuleOutcome> {
  return Promise.race([
    fn().then(({ result, error }) => ({ name, result: result ?? undefined, error })),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs / 1000}s`)), timeoutMs),
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

  const budget = new BudgetTracker(BUDGET_MS);
  let pass = 0;
  const accumulated: Record<string, { recordsIn: number; recordsOut: number; errors: string[] }> = {};

  for (const m of modules) {
    accumulated[m.name] = { recordsIn: 0, recordsOut: 0, errors: [] };
  }

  while (!budget.exceeded()) {
    pass++;
    let totalInThisPass = 0;
    let yielded = false;

    // Run modules SEQUENTIALLY so peak memory is bounded by a single module's
    // batch — previously this fanned out via Promise.allSettled and OOMed when
    // every module loaded its own batch concurrently.
    for (const m of modules) {
      if (budget.exceeded()) {
        yielded = true;
        break;
      }
      const remainingMs = budget.remainingMs();
      const perModuleTimeout = Math.min(MODULE_TIMEOUT_MS, Math.max(5_000, remainingMs - 5_000));

      const outcome = await withTimeout(m.name, m.fn, perModuleTimeout);
      if (outcome.result) {
        accumulated[m.name]!.recordsIn += outcome.result.recordsIn;
        accumulated[m.name]!.recordsOut += outcome.result.recordsOut;
        totalInThisPass += outcome.result.recordsIn;
      }
      if (outcome.error) {
        accumulated[m.name]!.errors.push(outcome.error);
      }
    }

    if (yielded) {
      console.log(`[process] Budget exhausted mid-pass ${pass}; yielding`);
      break;
    }

    if (totalInThisPass < IDLE_THRESHOLD) {
      console.log(`[process] Idle threshold reached after pass ${pass} (${totalInThisPass} records)`);
      break;
    }
  }

  const results: Record<string, unknown> = {
    processedAt: new Date().toISOString(),
    passes: pass,
    elapsedMs: budget.elapsedMs(),
    yieldedOnBudget: budget.exceeded(),
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
