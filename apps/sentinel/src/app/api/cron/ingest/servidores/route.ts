import { NextRequest } from "next/server";
import { ingestServidores } from "@sentinel/server/modules/pipeline/ingestion/ingest-servidores";
import { runIngestion } from "../_runner";

export async function GET(request: NextRequest) {
  return runIngestion(request, "servidores", ingestServidores);
}
