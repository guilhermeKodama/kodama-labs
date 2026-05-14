import { NextRequest } from "next/server";
import { ingestPoliticians } from "@sentinel/server/modules/pipeline/ingestion/ingest-politicians";
import { runIngestion } from "../_runner";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runIngestion(request, "politicians", ingestPoliticians);
}
