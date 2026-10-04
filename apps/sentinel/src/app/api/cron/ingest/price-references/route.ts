import { NextRequest } from "next/server";
import { ingestPriceReferences } from "@sentinel/server/modules/pipeline/ingestion/ingest-price-references";
import { runIngestion } from "../_runner";

export async function GET(request: NextRequest) {
  return runIngestion(request, "priceReferences", ingestPriceReferences);
}
