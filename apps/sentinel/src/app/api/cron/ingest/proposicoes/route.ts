import { NextRequest } from "next/server";
import { ingestProposicoes } from "@sentinel/server/modules/pipeline/ingestion/ingest-proposicoes";
import { runIngestion } from "../_runner";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runIngestion(request, "proposicoes", ingestProposicoes);
}
