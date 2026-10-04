import { NextRequest } from "next/server";
import { ingestPncpDetails } from "@sentinel/server/modules/pipeline/ingestion/ingest-pncp-details";
import { runIngestion } from "../_runner";

export async function GET(request: NextRequest) {
  return runIngestion(request, "pncpDetails", ingestPncpDetails);
}
