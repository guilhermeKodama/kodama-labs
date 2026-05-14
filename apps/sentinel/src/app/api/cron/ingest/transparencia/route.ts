import { NextRequest } from "next/server";
import { ingestTransparencia } from "@sentinel/server/modules/pipeline/ingestion/ingest-transparencia";
import { runIngestion } from "../_runner";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runIngestion(request, "transparencia", ingestTransparencia);
}
