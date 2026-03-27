import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { analyzeOverpricing } from "@sentinel/server/modules/pipeline/analysis/analyze-overpricing";
import { analyzeShellCompanies } from "@sentinel/server/modules/pipeline/analysis/analyze-shell-companies";
import { analyzeSanctions } from "@sentinel/server/modules/pipeline/analysis/analyze-sanctions";
import { analyzeNetwork } from "@sentinel/server/modules/pipeline/analysis/analyze-network";
import { analyzePoliticalLinks } from "@sentinel/server/modules/pipeline/analysis/analyze-political-links";
import { analyzeAi } from "@sentinel/server/modules/pipeline/analysis/analyze-ai";
import type { JobResult } from "@sentinel/server/lib/job-runner";

export const maxDuration = 300;

const BUDGET_MS = (maxDuration - 30) * 1000;
const MODULE_TIMEOUT_MS = 120_000;

type ModuleOutcome = { name: string; result?: JobResult; error?: string };

const modules: { name: string; fn: () => Promise<{ success: boolean; result?: JobResult; error?: string }> }[] = [
  { name: "overpricing", fn: analyzeOverpricing },
  { name: "shellCompanies", fn: analyzeShellCompanies },
  { name: "sanctions", fn: analyzeSanctions },
  { name: "network", fn: analyzeNetwork },
  { name: "politicalLinks", fn: analyzePoliticalLinks },
  { name: "ai", fn: analyzeAi },
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
  const remainingMs = BUDGET_MS - (Date.now() - start);
  const perModuleTimeout = Math.min(MODULE_TIMEOUT_MS, remainingMs - 5_000);

  const settled = await Promise.allSettled(
    modules.map((m) => withTimeout(m.name, m.fn, perModuleTimeout))
  );

  const results: Record<string, unknown> = {
    processedAt: new Date().toISOString(),
    elapsedMs: Date.now() - start,
  };

  for (const entry of settled) {
    if (entry.status === "fulfilled") {
      const { name, result, error } = entry.value;
      results[name] = {
        success: !error,
        result: result ?? undefined,
        ...(error ? { error } : {}),
      };
    } else {
      results["unknown"] = { success: false, error: entry.reason?.message ?? "Unknown" };
    }
  }

  return NextResponse.json(results);
}
