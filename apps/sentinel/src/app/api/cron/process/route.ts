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

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = {
    procurements: await processProcurements(),
    contracts: await processContracts(),
    items: await processItems(),
    entities: await processEntities(),
    linking: await linkData(),
    politicians: await processPoliticians(),
    donations: await processDonations(),
    assets: await processAssets(),
    servidores: await processServidores(),
    processedAt: new Date().toISOString(),
  };

  return NextResponse.json(results);
}
