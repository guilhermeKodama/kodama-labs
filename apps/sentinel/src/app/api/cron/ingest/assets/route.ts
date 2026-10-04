import { NextRequest } from "next/server";
import { ingestAssets } from "@sentinel/server/modules/pipeline/ingestion/ingest-assets";
import { runIngestion } from "../_runner";

export async function GET(request: NextRequest) {
  return runIngestion(request, "assets", ingestAssets);
}
