import { NextRequest } from "next/server";
import { ingestPncpContratos } from "@sentinel/server/modules/pipeline/ingestion/ingest-pncp";
import { runIngestion } from "../_runner";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runIngestion(request, "pncpContracts", ingestPncpContratos);
}
