import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import type { JobResult } from "@sentinel/server/lib/job-runner";

const DEFAULT_MODULE_TIMEOUT_MS = 240_000;

type IngestionFn = () => Promise<{ success: boolean; result?: JobResult; error?: string }>;

export async function runIngestion(
  request: NextRequest,
  name: string,
  fn: IngestionFn,
  timeoutMs: number = DEFAULT_MODULE_TIMEOUT_MS,
) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();

  try {
    const outcome = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${name} timed out after ${timeoutMs / 1000}s`)),
          timeoutMs,
        ),
      ),
    ]);

    return NextResponse.json({
      module: name,
      processedAt: new Date().toISOString(),
      elapsedMs: Date.now() - start,
      success: outcome.success,
      result: outcome.result ?? null,
      error: outcome.error ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        module: name,
        processedAt: new Date().toISOString(),
        elapsedMs: Date.now() - start,
        success: false,
        result: null,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
