import { NextRequest } from "next/server";
import { ingestCnpj } from "@sentinel/server/modules/pipeline/ingestion/ingest-cnpj";
import { runIngestion } from "../_runner";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runIngestion(request, "cnpj", ingestCnpj);
}
