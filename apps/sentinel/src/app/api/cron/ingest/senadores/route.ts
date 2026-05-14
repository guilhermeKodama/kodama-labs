import { NextRequest } from "next/server";
import { ingestSenadores } from "@sentinel/server/modules/pipeline/ingestion/ingest-senadores";
import { runIngestion } from "../_runner";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runIngestion(request, "senadores", ingestSenadores);
}
