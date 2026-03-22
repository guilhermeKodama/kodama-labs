import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { analyzeOverpricing } from "@sentinel/server/modules/pipeline/analysis/analyze-overpricing";
import { analyzeShellCompanies } from "@sentinel/server/modules/pipeline/analysis/analyze-shell-companies";
import { analyzeSanctions } from "@sentinel/server/modules/pipeline/analysis/analyze-sanctions";
import { analyzeNetwork } from "@sentinel/server/modules/pipeline/analysis/analyze-network";
import { analyzePoliticalLinks } from "@sentinel/server/modules/pipeline/analysis/analyze-political-links";
import { analyzeAi } from "@sentinel/server/modules/pipeline/analysis/analyze-ai";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = {
    overpricing: await analyzeOverpricing(),
    shellCompanies: await analyzeShellCompanies(),
    sanctions: await analyzeSanctions(),
    network: await analyzeNetwork(),
    politicalLinks: await analyzePoliticalLinks(),
    ai: await analyzeAi(),
    processedAt: new Date().toISOString(),
  };

  return NextResponse.json(results);
}
