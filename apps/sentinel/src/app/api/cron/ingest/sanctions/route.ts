import { NextRequest } from "next/server";
import { ingestSanctions } from "@sentinel/server/modules/pipeline/ingestion/ingest-sanctions";
import { runIngestion } from "../_runner";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runIngestion(request, "sanctions", ingestSanctions);
}
