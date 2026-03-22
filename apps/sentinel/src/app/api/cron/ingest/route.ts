import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { ingestPncp } from "@sentinel/server/modules/pipeline/ingestion/ingest-pncp";
import { ingestPncpDetails } from "@sentinel/server/modules/pipeline/ingestion/ingest-pncp-details";
import { ingestSanctions } from "@sentinel/server/modules/pipeline/ingestion/ingest-sanctions";
import { ingestCnpj } from "@sentinel/server/modules/pipeline/ingestion/ingest-cnpj";
import { ingestPoliticians } from "@sentinel/server/modules/pipeline/ingestion/ingest-politicians";
import { ingestDonations } from "@sentinel/server/modules/pipeline/ingestion/ingest-donations";
import { ingestAssets } from "@sentinel/server/modules/pipeline/ingestion/ingest-assets";
import { ingestServidores } from "@sentinel/server/modules/pipeline/ingestion/ingest-servidores";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = {
    pncp: await ingestPncp(),
    pncpDetails: await ingestPncpDetails(),
    sanctions: await ingestSanctions(),
    cnpj: await ingestCnpj(),
    politicians: await ingestPoliticians(),
    donations: await ingestDonations(),
    assets: await ingestAssets(),
    servidores: await ingestServidores(),
    processedAt: new Date().toISOString(),
  };

  return NextResponse.json(results);
}
