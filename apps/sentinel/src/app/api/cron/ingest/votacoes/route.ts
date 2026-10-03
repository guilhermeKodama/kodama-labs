import { NextRequest } from "next/server";
import { ingestVotacoes } from "@sentinel/server/modules/pipeline/ingestion/ingest-votacoes";
import { runIngestion } from "../_runner";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runIngestion(request, "votacoes", ingestVotacoes);
}
